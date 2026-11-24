import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { z } from "zod";
import { getHtmlViewUnitIds, isHtmlViewFilename, parseHtmlView, type HtmlViewDocument } from "@univerjs-labs/html-view";
import type { BlobStore } from "../../integrations/blob/blob-store.js";
import { logger } from "../../logging/logger.js";
import type { WorktreeDetail, WorktreesModule } from "../worktrees/index.js";
import type { IdentityModule } from "../identity/index.js";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver } from "../access/index.js";
import { type HtmlViewDraftsRepository, assertDraftDestination, requireDraftResource, requirePendingDraft, draftConflict } from "./drafts.repository.js";
import type { DraftRow, HtmlViewDraftView, PublishedPage } from "./drafts.types.js";

const id = z.string().trim().min(1).max(255);
const requestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    spaceId: id,
    parentNodeId: id.nullish(),
    name: id,
    html: z.string(),
    sourceWorktreeId: id.optional(),
  }).strict(),
  z.object({
    kind: z.literal("replace"),
    resourceId: id,
    etag: z
      .string()
      .max(200)
      .regex(/^"[^"\r\n]+"$/),
    html: z.string(),
    sourceWorktreeId: id.optional(),
  }).strict(),
  z.object({ kind: z.literal("revise"), draftId: id, html: z.string(), sourceWorktreeId: id.optional() }).strict(),
]);
const keySchema = z
  .string()
  .min(16)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
const PENDING_PAGES_PER_PULL_REQUEST = 20;
export type HtmlViewDraftsModule = ReturnType<typeof createHtmlViewDraftsModule>;

export function createHtmlViewDraftsModule(options: {
  repository: HtmlViewDraftsRepository;
  access: AccessResolver;
  store: BlobStore;
  worktrees: Pick<WorktreesModule, "get" | "holdReady">;
  users: Pick<IdentityModule, "findUsers">;
  now?: () => number;
}) {
  const { repository, access, store } = options;
  const now = options.now ?? Date.now;
  // Concurrent retries for the same draft must share one object upload.
  const receiving = new Map<string, Promise<DraftRow>>();
  const draftNotFound = () => new ApplicationError("NOT_FOUND", 404, "Draft not found.");
  async function requireDraft(userId: string, draftId: string): Promise<DraftRow> {
    const row = await repository.find(draftId);
    if (!row || row.author_user_id !== userId || row.state === "receiving") throw draftNotFound();
    return row;
  }
  async function readableDraft(userId: string, draftId: string) {
    const row = await repository.find(draftId);
    if (!row || row.state === "receiving") throw draftNotFound();
    if (row.author_user_id === userId) return { row, source: undefined };
    const source = row.source_worktree_id === null ? undefined : await reviewable(userId, row.source_worktree_id);
    if (!source) throw draftNotFound();
    return { row, source };
  }
  async function reviewable(userId: string, worktreeId: string): Promise<WorktreeDetail | undefined> {
    try {
      const { worktree } = await options.worktrees.get(userId, worktreeId);
      return worktree.capabilities.review ? worktree : undefined;
    } catch (error) {
      if (error instanceof ApplicationError && error.status === 404) return undefined;
      throw error;
    }
  }
  async function validateCreate(userId: string, spaceId: string, parentNodeId: string | null, proposes = false) {
    const target =
      parentNodeId === null
        ? await access.resolveSpace(userId, spaceId)
        : await access.resolveNode(userId, parentNodeId);
    assertDraftDestination(target, spaceId, proposes);
  }
  async function validateReplace(userId: string, resourceId: string, proposes = (_spaceId: string) => false) {
    const target = await access.resolveResource(userId, resourceId);
    return requireDraftResource(target, target && proposes(target.node.spaceId) ? "openContent" : "editContent");
  }
  async function mayWrite(userId: string, row: DraftRow): Promise<boolean> {
    try {
      if (row.kind === "create") await validateCreate(userId, row.space_id, row.parent_node_id);
      else await validateReplace(userId, row.target_resource_id!);
      return true;
    } catch (error) {
      if (error instanceof ApplicationError) return false;
      throw error;
    }
  }
  async function livePages(worktreeId: string, before = Infinity): Promise<DraftRow[]> {
    return (await repository.pendingForWorktree(worktreeId)).filter((row) => row.expires_at > now() && row.updated_at <= before);
  }
  async function sourceWorktree(userId: string, worktreeId: string) {
    const worktree = await reviewable(userId, worktreeId);
    if (!worktree) throw new ApplicationError("NOT_FOUND", 404, "Source pull request not found.");
    return worktree;
  }
  async function requireReadableBindings(userId: string, document: HtmlViewDocument, source: WorktreeDetail | undefined) {
    const mapped = new Set(source?.units.map((unit) => unit.unitId));
    for (const unitId of getHtmlViewUnitIds(document)) {
      if (!mapped.has(unitId) && !(await access.resolveUnitContent(userId, unitId))?.capabilities.openContent)
        throw new ApplicationError("FORBIDDEN", 403, `The page binds a Sheet you cannot read: ${unitId}.`);
    }
  }
  async function view(row: DraftRow, readerId: string, known?: WorktreeDetail): Promise<HtmlViewDraftView> {
    if (row.state === "receiving") throw draftConflict("Draft content is still receiving.");
    let state: HtmlViewDraftView["state"] = row.state;
    const source = state === "pending" && row.source_worktree_id !== null
      ? known ?? await sourceWorktree(readerId, row.source_worktree_id) : undefined;
    if (source?.state === "discarded") state = "conflicted";
    if (state === "pending" && row.expires_at <= now()) state = "expired";
    else if (state === "pending" && row.kind === "replace") {
      const etag = await repository.currentEtag(row.target_resource_id!);
      if (etag !== undefined && etag !== row.base_etag) state = "conflicted";
    }
    const [author] = await options.users.findUsers([row.author_user_id]);
    return {
      id: row.id,
      author: author!,
      kind: row.kind,
      state,
      ...(state === "pending" ? { publishWhen: source && source.state !== "merged" ? "merge" as const : "publish" as const } : {}),
      supersededBy: row.superseded_by,
      spaceId: row.space_id,
      sourceWorktreeId: row.source_worktree_id,
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
  async function publish(userId: string, draftId: string) {
    const row = await requireDraft(userId, draftId);
    if (row.state === "published") return view(row, userId);
    requirePendingDraft(row, now());
    if (row.source_worktree_id !== null) {
      const worktree = await sourceWorktree(userId, row.source_worktree_id);
      if (worktree.state === "discarded") throw draftConflict("Draft is conflicted because its source pull request was discarded.");
      if (worktree.state !== "merged") throw draftConflict(`Waiting for pull request #${worktree.number ?? worktree.id} to merge.`);
    }
    const decided = await repository.decide(row.id, userId, "publish", now());
    if (decided.state !== "published") throw draftConflict(`Draft is ${decided.state}.`);
    return view(decided, userId);
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
      const request = parsed.data;
      const previous = request.kind === "revise" ? await requireDraft(userId, request.draftId) : undefined;
      const input = request.kind === "revise" && previous
        ? previous.kind === "create"
          ? { kind: "create" as const, spaceId: previous.space_id, parentNodeId: previous.parent_node_id,
              name: previous.name, html: request.html, sourceWorktreeId: request.sourceWorktreeId ?? previous.source_worktree_id ?? undefined }
          : { kind: "replace" as const, resourceId: previous.target_resource_id!, etag: `"${previous.base_etag}"`,
              html: request.html, sourceWorktreeId: request.sourceWorktreeId ?? previous.source_worktree_id ?? undefined }
        : request;
      if (input.kind === "revise") throw new Error("Revision draft is missing.");
      // Until this draft is pending, its pull request cannot turn ready, so a reviewer sees every page it merges.
      using _hold = input.sourceWorktreeId === undefined ? undefined : await options.worktrees.holdReady(input.sourceWorktreeId);
      let row = await repository.findKey(userId, key.data);
      if (previous && !row) {
        requirePendingDraft(previous, now());
        const state = (await view(previous, userId)).state;
        if (state !== "pending") throw draftConflict(`Draft is ${state}.`);
      }
      const source = input.sourceWorktreeId === undefined ? undefined : await sourceWorktree(userId, input.sourceWorktreeId);
      if (source?.state === "discarded") throw draftConflict("Source pull request was discarded.");
      const left = previous?.source_worktree_id && previous.source_worktree_id !== input.sourceWorktreeId
        ? await sourceWorktree(userId, previous.source_worktree_id) : undefined;
      // A reviewer must merge the pages they saw, so a pull request under review takes no page changes.
      for (const worktree of [source, left]) {
        if (worktree?.state === "ready" || worktree?.state === "merging")
          throw draftConflict(`Pull request #${worktree.number ?? worktree.id} is ${worktree.state}. Reopen it to change its pages.`);
      }
      const bytes = Buffer.from(input.html, "utf8");
      if (bytes.length > 512 * 1024)
        throw new ApplicationError("PAYLOAD_TOO_LARGE", 413, "HTML View exceeds 512 KiB.");
      let document: HtmlViewDocument;
      try {
        document = parseHtmlView(input.html);
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
      let created = false;
      if (!row) {
        await requireReadableBindings(userId, document, source);
        if (source && (await livePages(source.id)).filter((draft) => draft.id !== previous?.id).length >= PENDING_PAGES_PER_PULL_REQUEST)
          throw draftConflict(`Pull request #${source.number ?? source.id} already has ${PENDING_PAGES_PER_PULL_REQUEST} pending pages. Revise one of them instead.`);
        // The author of a Team pull request proposes pages in its Space as it proposes Units; whoever merges needs edit access.
        const proposes = (spaceId: string) =>
          source?.kind === "team" && source.teamSpace?.id === spaceId && source.capabilities.editDraft;
        let spaceId: string;
        let displayName: string;
        if (input.kind === "create") {
          await validateCreate(userId, input.spaceId, input.parentNodeId ?? null, proposes(input.spaceId));
          spaceId = input.spaceId;
          displayName = name!;
        } else {
          const target = await validateReplace(userId, input.resourceId, proposes);
          if (!previous && target.etag !== input.etag.slice(1, -1))
            throw new ApplicationError("PRECONDITION_FAILED", 412, "HTML View content changed.");
          spaceId = target.node.spaceId;
          displayName = target.node.name;
        }
        const reservation = await repository.reserve(
          {
            author_user_id: userId,
            idempotency_key: key.data,
            kind: input.kind,
            revises_draft_id: previous?.id ?? null,
            space_id: spaceId,
            source_worktree_id: input.sourceWorktreeId ?? null,
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
        row.revises_draft_id === (previous?.id ?? null) &&
        row.kind === input.kind &&
        row.sha256 === sha256 &&
        row.source_worktree_id === (input.sourceWorktreeId ?? null) &&
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
      return { status: created ? 201 : 200, draft: await view(row, userId) };
    },
    async get(userId: string, draftId: string) {
      const { row, source } = await readableDraft(userId, draftId);
      return view(row, userId, source);
    },
    async listForWorktree(userId: string, worktreeId: string) {
      const source = await reviewable(userId, worktreeId);
      if (!source) throw new ApplicationError("NOT_FOUND", 404, "Pull request not found.");
      return Promise.all((await repository.listForWorktree(worktreeId)).map((row) => view(row, userId, source)));
    },
    async openContent(userId: string, draftId: string) {
      const { row, source } = await readableDraft(userId, draftId);
      if (row.state !== "pending" || !["pending", "conflicted"].includes((await view(row, userId, source)).state))
        throw draftConflict("Draft bytes are no longer available.");
      return { ...(await store.open({ objectKey: row.object_key })), byteSize: row.byte_size };
    },
    publish,
    async writable(worktreeId: string, userId: string, before?: number): Promise<boolean> {
      for (const row of await livePages(worktreeId, before)) if (!(await mayWrite(userId, row))) return false;
      return true;
    },
    async foreign(worktreeId: string, before: number): Promise<string[]> {
      const names: string[] = [];
      for (const row of await livePages(worktreeId, before)) if (!(await mayWrite(row.author_user_id, row))) names.push(row.name);
      return names;
    },
    /** Publishes as the merger each draft that was pending before the merge began; a later one was never reviewed with it. */
    async publishForWorktree(worktreeId: string, mergerId: string, before: number): Promise<PublishedPage[]> {
      const publishedPages: PublishedPage[] = [];
      const rows = (await repository.pendingForWorktree(worktreeId)).filter((row) => row.updated_at <= before);
      for (const row of rows) {
        try {
          if (row.expires_at <= now()) throw draftConflict("Draft expired.");
          const draft = await repository.decide(row.id, mergerId, "publish", now());
          if (draft.state !== "published") throw draftConflict(`Draft is ${draft.state}.`);
          publishedPages.push({ draftId: row.id, name: row.name, nodeId: draft.result_node_id! });
        } catch (error) {
          logger.warn({ err: error, worktreeId, draftId: row.id }, "HTML View draft was not published after merge");
        }
      }
      return publishedPages;
    },
    async reject(userId: string, draftId: string) {
      const row = await requireDraft(userId, draftId);
      if (row.state === "rejected") return view(row, userId);
      requirePendingDraft(row, now());
      const decided = await repository.decide(row.id, userId, "reject", now());
      if (decided.state !== "rejected") throw draftConflict(`Draft is ${decided.state}.`);
      return view(decided, userId);
    },
    async expireDue(time: number, limit: number) {
      return repository.expireDue(time, limit, [...receiving.keys()]);
    },
  };
}
