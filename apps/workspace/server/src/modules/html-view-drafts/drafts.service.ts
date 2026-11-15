import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { z } from "zod";
import { isHtmlViewFilename, parseHtmlView } from "@univerjs-labs/html-view";
import type { BlobStore } from "../../integrations/blob/blob-store.js";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver } from "../access/index.js";
import { type HtmlViewDraftsRepository, assertDraftDestination, requireDraftResource, draftConflict } from "./drafts.repository.js";
import type { DraftRow, HtmlViewDraftView } from "./drafts.types.js";

const id = z.string().trim().min(1).max(255);
const requestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    spaceId: id,
    parentNodeId: id.nullish(),
    name: id,
    html: z.string(),
  }),
  z.object({
    kind: z.literal("replace"),
    resourceId: id,
    etag: z
      .string()
      .max(200)
      .regex(/^"[^"\r\n]+"$/),
    html: z.string(),
  }),
]);
const keySchema = z
  .string()
  .min(16)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
export type HtmlViewDraftsModule = ReturnType<typeof createHtmlViewDraftsModule>;

export function createHtmlViewDraftsModule(options: {
  repository: HtmlViewDraftsRepository;
  access: AccessResolver;
  store: BlobStore;
  now?: () => number;
}) {
  const { repository, access, store } = options;
  const now = options.now ?? Date.now;
  // Concurrent retries for the same draft must share one object upload.
  const receiving = new Map<string, Promise<DraftRow>>();
  async function requireDraft(userId: string, draftId: string): Promise<DraftRow> {
    const row = await repository.find(draftId);
    if (!row || row.author_user_id !== userId || row.state === "receiving")
      throw new ApplicationError("NOT_FOUND", 404, "Draft not found.");
    return row;
  }
  async function validateCreate(userId: string, spaceId: string, parentNodeId: string | null) {
    const target =
      parentNodeId === null
        ? await access.resolveSpace(userId, spaceId)
        : await access.resolveNode(userId, parentNodeId);
    assertDraftDestination(target, spaceId);
  }
  async function validateReplace(userId: string, resourceId: string) {
    const target = await access.resolveResource(userId, resourceId);
    return requireDraftResource(target);
  }
  async function view(row: DraftRow): Promise<HtmlViewDraftView> {
    if (row.state === "receiving") throw draftConflict("Draft content is still receiving.");
    let state: HtmlViewDraftView["state"] = row.state;
    if (state === "pending" && row.expires_at <= now()) state = "expired";
    else if (state === "pending" && row.kind === "replace") {
      const etag = await repository.currentEtag(row.target_resource_id!);
      if (etag !== undefined && etag !== row.base_etag) state = "conflicted";
    }
    return {
      id: row.id,
      kind: row.kind,
      state,
      spaceId: row.space_id,
      parentNodeId: row.parent_node_id,
      name: row.name,
      targetResourceId: row.target_resource_id,
      baseEtag: row.base_etag === null ? null : `"${row.base_etag}"`,
      byteSize: row.byte_size,
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      decidedAt: row.decided_at === null ? null : new Date(row.decided_at).toISOString(),
      published:
        row.state === "published"
          ? {
              nodeId: row.result_node_id!,
              resourceId: row.result_resource_id!,
              etag: `"${row.result_etag}"`,
            }
          : null,
    };
  }
  return {
    async submit(userId: string, keyValue: unknown, body: unknown) {
      const parsed = requestSchema.safeParse(body);
      const key = keySchema.safeParse(keyValue);
      if (!parsed.success || !key.success)
        throw new ApplicationError(
          "INVALID_INPUT",
          400,
          "Invalid draft request or Idempotency-Key.",
        );
      const input = parsed.data;
      const bytes = Buffer.from(input.html, "utf8");
      if (bytes.length > 512 * 1024)
        throw new ApplicationError("PAYLOAD_TOO_LARGE", 413, "HTML View exceeds 512 KiB.");
      try {
        parseHtmlView(input.html);
      } catch {
        throw new ApplicationError("INVALID_INPUT", 400, "Invalid HTML View structure.");
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const name =
        input.kind === "create"
          ? isHtmlViewFilename(input.name)
            ? input.name
            : `${input.name}.univer.html`
          : null;
      if (name && name.length > 255)
        throw new ApplicationError("INVALID_INPUT", 400, "Draft name is too long.");
      let row = await repository.findKey(userId, key.data);
      let created = false;
      if (!row) {
        let spaceId: string;
        let displayName: string;
        if (input.kind === "create") {
          await validateCreate(userId, input.spaceId, input.parentNodeId ?? null);
          spaceId = input.spaceId;
          displayName = name!;
        } else {
          const target = await validateReplace(userId, input.resourceId);
          if (target.etag !== input.etag.slice(1, -1))
            throw new ApplicationError("PRECONDITION_FAILED", 412, "HTML View content changed.");
          spaceId = target.node.spaceId;
          displayName = target.node.name;
        }
        const reservation = await repository.reserve(
          {
            author_user_id: userId,
            idempotency_key: key.data,
            kind: input.kind,
            space_id: spaceId,
            parent_node_id: input.kind === "create" ? (input.parentNodeId ?? null) : null,
            name: displayName,
            target_resource_id: input.kind === "replace" ? input.resourceId : null,
            base_etag: input.kind === "replace" ? input.etag.slice(1, -1) : null,
            sha256,
            byte_size: bytes.length,
          },
          now(),
        );
        row = reservation.row;
        created = reservation.created;
      }
      const same =
        row.kind === input.kind &&
        row.sha256 === sha256 &&
        (input.kind === "create"
          ? row.space_id === input.spaceId &&
            row.parent_node_id === (input.parentNodeId ?? null) &&
            row.name === name
          : row.target_resource_id === input.resourceId &&
            row.base_etag === input.etag.slice(1, -1));
      if (!same) throw draftConflict("Idempotency-Key belongs to another draft intent.");
      if (
        (row.state === "pending" || row.state === "receiving" || row.state === "expired") &&
        row.expires_at <= now()
      )
        throw draftConflict("Draft expired; use a new Idempotency-Key.");
      if (row.state === "receiving") {
        const reserved = row;
        let pending = receiving.get(row.id);
        if (!pending) {
          pending = (async () => {
            const stored = await store.put({
              objectKey: reserved.object_key,
              body: Readable.from([bytes]),
              expectedByteSize: bytes.length,
            });
            if (stored.sha256 !== sha256)
              throw new Error("Draft bytes failed checksum verification.");
            const row = await repository.markPending(reserved.id, stored, now());
            if (row.state === "receiving") {
              await repository.decide(row.id, userId, "reject", now());
              throw draftConflict("Draft expired; use a new Idempotency-Key.");
            }
            return row;
          })();
          receiving.set(row.id, pending);
        }
        try {
          row = await pending;
        } finally {
          if (receiving.get(reserved.id) === pending) receiving.delete(reserved.id);
        }
      }
      return { status: created ? 201 : 200, draft: await view(row) };
    },
    async get(userId: string, draftId: string) {
      return view(await requireDraft(userId, draftId));
    },
    async openContent(userId: string, draftId: string) {
      const row = await requireDraft(userId, draftId);
      if (row.state !== "pending" || !["pending", "conflicted"].includes((await view(row)).state))
        throw draftConflict("Draft bytes are no longer available.");
      return { ...(await store.open({ objectKey: row.object_key })), byteSize: row.byte_size };
    },
    async publish(userId: string, draftId: string) {
      const row = await requireDraft(userId, draftId);
      if (row.state === "published") return view(row);
      if (row.state !== "pending") throw draftConflict(`Draft is ${row.state}.`);
      const decided = await repository.decide(row.id, userId, "publish", now());
      if (decided.state !== "published") throw draftConflict(`Draft is ${decided.state}.`);
      return view(decided);
    },
    async reject(userId: string, draftId: string) {
      const row = await requireDraft(userId, draftId);
      if (row.state === "rejected") return view(row);
      if (row.state !== "pending") throw draftConflict(`Draft is ${row.state}.`);
      const decided = await repository.decide(row.id, userId, "reject", now());
      if (decided.state !== "rejected") throw draftConflict(`Draft is ${decided.state}.`);
      return view(decided);
    },
    async expireDue(time: number, limit: number) {
      return repository.expireDue(time, limit, [...receiving.keys()]);
    },
  };
}
