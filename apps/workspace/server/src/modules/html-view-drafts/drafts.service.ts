import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { z } from "zod";
import { isHtmlViewFilename, parseHtmlView } from "@univerjs-labs/html-view";
import type { BlobStore } from "../../integrations/blob/blob-store.js";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver } from "../access/index.js";
import { HtmlViewDraftsRepository, draftConflict } from "./drafts.repository.js";
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
  // LocalBlobStore uses one temporary file per object key; coalesce concurrent retries.
  const receiving = new Map<string, Promise<DraftRow>>();
  function requireDraft(userId: string, draftId: string): DraftRow {
    const row = repository.find(draftId);
    if (!row || row.author_user_id !== userId || row.state === "receiving")
      throw new ApplicationError("NOT_FOUND", 404, "Draft not found.");
    return row;
  }
  function validateCreate(userId: string, spaceId: string, parentNodeId: string | null) {
    const target =
      parentNodeId === null
        ? access.resolveSpace(userId, spaceId)
        : access.resolveNode(userId, parentNodeId);
    if (!target || ("spaceId" in target && target.spaceId !== spaceId))
      throw new ApplicationError("NOT_FOUND", 404, "Draft destination not found.");
    const allowed =
      "createAtRoot" in target.capabilities
        ? target.capabilities.createAtRoot
        : target.capabilities.createChildren;
    if (!allowed)
      throw new ApplicationError("FORBIDDEN", 403, "Cannot create at the draft destination.");
  }
  function validateReplace(userId: string, resourceId: string) {
    const target = access.resolveResource(userId, resourceId);
    if (!target || target.kind !== "blob")
      throw new ApplicationError("NOT_FOUND", 404, "Draft target not found.");
    if (!target.capabilities.editContent)
      throw new ApplicationError("FORBIDDEN", 403, "Cannot edit draft target.");
    if (
      target.availability !== "ready" ||
      !(isHtmlViewFilename(target.node.name) || isHtmlViewFilename(target.originalFilename))
    )
      throw draftConflict("Draft target is not an available HTML View.");
    return target;
  }
  function view(row: DraftRow): HtmlViewDraftView {
    if (row.state === "receiving") throw draftConflict("Draft content is still receiving.");
    const state =
      row.state === "pending" && row.expires_at <= now()
        ? "expired"
        : row.state === "pending" &&
            row.kind === "replace" &&
            repository.currentEtag(row.target_resource_id!) !== undefined &&
            repository.currentEtag(row.target_resource_id!) !== row.base_etag
          ? "conflicted"
          : row.state;
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
      let row = repository.findKey(userId, key.data);
      const created = !row;
      if (row) {
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
      } else {
        let spaceId: string;
        let displayName: string;
        if (input.kind === "create") {
          validateCreate(userId, input.spaceId, input.parentNodeId ?? null);
          spaceId = input.spaceId;
          displayName = name!;
        } else {
          const target = validateReplace(userId, input.resourceId);
          if (target.etag !== input.etag.slice(1, -1))
            throw new ApplicationError("PRECONDITION_FAILED", 412, "HTML View content changed.");
          spaceId = target.node.spaceId;
          displayName = target.node.name;
        }
        row = repository.reserve(
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
      }
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
            const row = repository.markPending(reserved.id, stored, now());
            if (row.state === "receiving") {
              repository.decide(row.id, userId, "reject", now());
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
      return { status: created ? 201 : 200, draft: view(row) };
    },
    get(userId: string, draftId: string) {
      return view(requireDraft(userId, draftId));
    },
    async openContent(userId: string, draftId: string) {
      const row = requireDraft(userId, draftId);
      if (row.state !== "pending" || !["pending", "conflicted"].includes(view(row).state))
        throw draftConflict("Draft bytes are no longer available.");
      return { ...(await store.open({ objectKey: row.object_key })), byteSize: row.byte_size };
    },
    publish(userId: string, draftId: string) {
      const row = requireDraft(userId, draftId);
      if (row.state === "published") return view(row);
      if (row.state !== "pending") throw draftConflict(`Draft is ${row.state}.`);
      if (row.expires_at > now()) {
        if (row.kind === "create") validateCreate(userId, row.space_id, row.parent_node_id);
        else validateReplace(userId, row.target_resource_id!);
      }
      const decided = repository.decide(row.id, userId, "publish", now());
      if (decided.state !== "published") throw draftConflict(`Draft is ${decided.state}.`);
      return view(decided);
    },
    reject(userId: string, draftId: string) {
      const row = requireDraft(userId, draftId);
      if (row.state === "rejected") return view(row);
      if (row.state !== "pending") throw draftConflict(`Draft is ${row.state}.`);
      const decided = repository.decide(row.id, userId, "reject", now());
      if (decided.state !== "rejected") throw draftConflict(`Draft is ${decided.state}.`);
      return view(decided);
    },
    expireDue(time: number, limit: number) {
      return repository.expireDue(time, limit, [...receiving.keys()]);
    },
  };
}
