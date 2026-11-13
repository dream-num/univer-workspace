import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { z } from "zod";
import type { BlobStore } from "../../integrations/blob/blob-store.js";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver } from "../access/index.js";
import { SkillDraftsRepository, draftConflict, type SkillTarget } from "./drafts.repository.js";
import {
  draftBase,
  draftFiles,
  draftKeep,
  reviewFindingSchema,
  type DraftRow,
  type ScanFinding,
  type SkillDraftView,
  type VerifiedReviewFinding,
} from "./drafts.types.js";
import {
  compatibility,
  decodeSkillText,
  safeSkillPath,
  scanSkill,
  verifyReview,
  type ScanFile,
} from "./scan.js";

import { fromSourceSchema } from "./sources.types.js";
import { checkSkillLimits, type SkillSourcesModule } from "./sources.service.js";
import { importSkillFiles } from "./sources.metadata.js";

const requestSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    spaceId: z.string().min(1).max(255),
    replace: z.boolean().default(false),
    files: z
      .array(z.object({ path: z.string().min(1).max(1024), text: z.string() }).strict())
      .min(1).optional(),
    from: fromSourceSchema.optional(),
    keep: z.array(z.string().min(1).max(1024)).default([]),
    review: z.array(reviewFindingSchema).max(500).default([]),
  })
  .strict().refine((s) => (s.files !== undefined) !== (s.from !== undefined));
const keySchema = z
  .string()
  .min(16)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
export type SkillDraftsModule = ReturnType<typeof createSkillDraftsModule>;

export function createSkillDraftsModule(options: {
  repository: SkillDraftsRepository;
  access: AccessResolver;
  store: BlobStore;
  sources: SkillSourcesModule;
  now?: () => number;
}) {
  const { repository, access, store } = options;
  const now = options.now ?? Date.now;
  const receiving = new Map<string, Promise<DraftRow>>();
  const publishing = new Set<string>();
  const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
  function requireDraft(userId: string, id: string): DraftRow {
    const row = repository.find(id);
    if (!row || row.author_user_id !== userId || row.state === "receiving")
      throw new ApplicationError("NOT_FOUND", 404, "Draft not found.");
    return row;
  }
  function authorize(userId: string, spaceId: string, target?: SkillTarget) {
    const space = access.resolveSpace(userId, spaceId);
    if (!space) throw new ApplicationError("NOT_FOUND", 404, "Draft destination not found.");
    if (
      (space.type === "personal" && space.ownerUserId !== userId) ||
      !space.capabilities.createAtRoot
    )
      throw new ApplicationError("FORBIDDEN", 403, "Cannot create Skills at this destination.");
    if (
      target?.folderNodeId &&
      !access.resolveNode(userId, target.folderNodeId)?.capabilities.createChildren
    )
      throw new ApplicationError("FORBIDDEN", 403, "Cannot edit the Skill folder.");
    for (const file of target?.files ?? []) {
      const resource = access.resolveResource(userId, file.resourceId);
      if (
        !resource?.capabilities.editContent ||
        !access.resolveNode(userId, file.nodeId)?.capabilities.trash
      )
        throw new ApplicationError("FORBIDDEN", 403, "Cannot replace Skill files.");
    }
  }
  function view(row: DraftRow): SkillDraftView {
    if (row.state === "receiving") throw draftConflict("Draft content is still receiving.");
    const files = draftFiles(row);
    const base = draftBase(row);
    const keep = draftKeep(row);
    const scan: ScanFinding[] = JSON.parse(row.scan);
    const review: VerifiedReviewFinding[] = JSON.parse(row.review);
    return {
      id: row.id,
      kind: base === null ? "create" : "replace",
      state: row.state === "pending" && row.expires_at <= now() ? "expired" : row.state,
      name: row.name,
      spaceId: row.space_id,
      previewPath: `/drafts/skills/${row.id}`,
      files: files.map(({ objectKey: _, ...file }) => file),
      base: base?.map((file) => ({ ...file, etag: `"${file.etag}"` })) ?? null,
      keep,
      removedPaths: (base ?? [])
        .filter(
          (file) => !files.some((item) => item.path === file.path) && !keep.includes(file.path),
        )
        .map((file) => file.path),
      scan,
      review,
      source: row.source === null ? null : JSON.parse(row.source),
      unverifiedReviewCount: row.unverified_review_count,
      compatibility: compatibility(scan, review),
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      decidedAt: row.decided_at === null ? null : new Date(row.decided_at).toISOString(),
      published:
        row.result_folder_node_id === null ? null : { folderNodeId: row.result_folder_node_id },
    };
  }
  async function readFile(file: { objectKey: string; byteSize: number }): Promise<Buffer> {
    const opened = await store.open({ objectKey: file.objectKey });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of opened.stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > file.byteSize) {
        opened.stream.destroy();
        throw draftConflict("Stored Skill content length changed.");
      }
      chunks.push(bytes);
    }
    if (size !== file.byteSize) throw draftConflict("Stored Skill content length changed.");
    return Buffer.concat(chunks);
  }
  return {
    async submit(userId: string, keyValue: unknown, body: unknown) {
      const parsed = requestSchema.safeParse(body);
      const key = keySchema.safeParse(keyValue);
      if (!parsed.success || !key.success)
        throw new ApplicationError(
          "INVALID_INPUT",
          400,
          "Invalid Skill draft request or Idempotency-Key.",
        );
      const input = parsed.data;
      const existing = repository.findKey(userId, key.data);
      const fromIntent = input.from ? hash(JSON.stringify({ ...input, keep: [...input.keep].sort(), from: {
        ...input.from, overrides: [...input.from.overrides].sort((a, b) => a.path.localeCompare(b.path, "en")),
      } })) : null;
      if (existing && fromIntent) {
        if (existing.intent_sha256 !== fromIntent) throw draftConflict("Idempotency-Key belongs to another draft intent.");
        if (["receiving", "pending", "expired"].includes(existing.state) && existing.expires_at <= now())
          throw draftConflict("Draft expired; use a new Idempotency-Key.");
        if (existing.state !== "receiving") return { status: 200, draft: view(existing) };
      }
      if (input.from) authorize(userId, input.spaceId);
      const imported = input.from ? await options.sources.intake(userId, input.from.source, input.from.skill) : null;
      const receivedAt = existing?.created_at ?? now();
      const files = (imported && input.from ? await importSkillFiles({
        ...imported, skill: input.from.skill, name: input.name, importedAt: receivedAt, overrides: input.from.overrides,
      }) : input.files!.map((file) => ({ path: file.path, bytes: Buffer.from(file.text, "utf8") })))
        .sort((a, b) => a.path.localeCompare(b.path, "en"));
      checkSkillLimits(files);
      if (!input.from && files.some((file) => decodeSkillText(file.bytes) === null))
        throw new ApplicationError("INVALID_INPUT", 400, "This endpoint accepts UTF-8 text without NUL bytes.");
      if (
        new Set(input.keep).size !== input.keep.length ||
        input.keep.some((path) => !safeSkillPath(path) || files.some((file) => file.path === path))
      )
        throw new ApplicationError(
          "INVALID_INPUT",
          400,
          "keep must contain unique base paths absent from files.",
        );
      const intent = fromIntent ?? hash(
        JSON.stringify({
          ...input,
          files: files.map((file) => ({ path: file.path, sha256: hash(file.bytes) })),
          keep: [...input.keep].sort(),
        }),
      );
      let row = repository.findKey(userId, key.data);
      let created = false;
      if (row && row.intent_sha256 !== intent)
        throw draftConflict("Idempotency-Key belongs to another draft intent.");
      if (!row) {
        authorize(userId, input.spaceId);
        const target = repository.target(input.spaceId, input.name);
        if (input.replace && !target.folderNodeId)
          throw new ApplicationError("NOT_FOUND", 404, "Skill to replace not found.");
        if (input.replace) authorize(userId, input.spaceId, target);
        const base = input.replace
          ? target.files.map(({ path, resourceId, etag }) => ({ path, resourceId, etag }))
          : null;
        if (input.keep.some((path) => !base?.some((file) => file.path === path)))
          throw new ApplicationError(
            "INVALID_INPUT",
            400,
            "keep paths must belong to the replacement base.",
          );
        const scan = await scanSkill(input.name, files, {
          ...imported?.context,
          nameConflict:
            (!input.replace && target.nonEmpty) ||
            repository.personalNameConflict(userId, input.spaceId, input.name),
        });
        const verified = verifyReview(files, input.review);
        const reserved = repository.reserve(
          {
            author_user_id: userId,
            idempotency_key: key.data,
            intent_sha256: intent,
            space_id: input.spaceId,
            name: input.name,
            target_folder_node_id: input.replace ? target.folderNodeId : null,
            files: JSON.stringify(
              files.map((file) => ({
                path: file.path,
                byteSize: file.bytes.length,
                sha256: hash(file.bytes),
                kind: decodeSkillText(file.bytes) === null ? "binary" : "text",
                objectKey: randomUUID(),
                mediaType: decodeSkillText(file.bytes) === null ? "application/octet-stream" : "text/plain; charset=utf-8",
              })),
            ),
            base: base === null ? null : JSON.stringify(base),
            keep: JSON.stringify(input.keep),
            scan: JSON.stringify(scan),
            review: JSON.stringify(verified.review),
            unverified_review_count: verified.unverifiedReviewCount,
            source: imported ? JSON.stringify(imported.source) : null,
          },
          receivedAt,
        );
        row = reserved.row;
        created = reserved.created;
      }
      if (["receiving", "pending", "expired"].includes(row.state) && row.expires_at <= now())
        throw draftConflict("Draft expired; use a new Idempotency-Key.");
      if (row.state === "receiving") {
        const reserved = row;
        let pending = receiving.get(row.id);
        if (!pending) {
          pending = (async () => {
            for (const [index, file] of draftFiles(reserved).entries()) {
              const content = files[index]!;
              const stored = await store.put({
                objectKey: file.objectKey,
                body: Readable.from([content.bytes]),
                expectedByteSize: file.byteSize,
                detectMediaType: false,
              });
              if (stored.sha256 !== file.sha256)
                throw draftConflict("Stored Skill content failed checksum verification.");
            }
            const row = repository.markPending(reserved.id, now());
            if (row.state !== "pending") {
              repository.decide(reserved.id, userId, "reject", now());
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
    get(userId: string, id: string) {
      return view(requireDraft(userId, id));
    },
    async openContent(userId: string, id: string, path: unknown, version: unknown) {
      const row = requireDraft(userId, id);
      if (
        typeof path !== "string" ||
        !safeSkillPath(path) ||
        (version !== undefined && version !== "draft" && version !== "current")
      )
        throw new ApplicationError("INVALID_INPUT", 400, "Invalid file path or version.");
      if (version === "current") {
        authorize(userId, row.space_id);
        const file = repository
          .target(row.space_id, row.name)
          .files.find((file) => file.path === path);
        const resource = file && access.resolveResource(userId, file.resourceId);
        if (!file || !resource?.capabilities.openContent)
          throw new ApplicationError("NOT_FOUND", 404, "Current Skill file not found.");
        return { ...(await store.open({ objectKey: file.objectKey })), byteSize: file.byteSize };
      }
      if (row.state !== "pending" || row.expires_at <= now())
        throw draftConflict("Draft bytes are no longer available.");
      const file = draftFiles(row).find((file) => file.path === path);
      if (!file) throw new ApplicationError("NOT_FOUND", 404, "Draft file not found.");
      return { ...(await store.open({ objectKey: file.objectKey })), byteSize: file.byteSize };
    },
    async publish(userId: string, id: string) {
      const row = requireDraft(userId, id);
      if (row.state === "published") return view(row);
      if (row.state !== "pending") throw draftConflict(`Draft is ${row.state}.`);
      if (row.expires_at <= now()) {
        repository.decide(id, userId, "reject", now());
        throw draftConflict("Draft is expired.");
      }
      authorize(userId, row.space_id);
      publishing.add(id);
      try {
        const files: ScanFile[] = [];
        for (const file of draftFiles(row)) {
          const bytes = await readFile(file);
          if (hash(bytes) !== file.sha256)
            throw draftConflict("Stored Skill content failed checksum verification.");
          files.push({ path: file.path, bytes });
        }
        const scan = await scanSkill(row.name, files);
        if (scan.some((finding) => finding.severity === "block"))
          throw draftConflict("Static scan blocks publication.");
        const decided = repository.decide(id, userId, "publish", now(), (draft, target) =>
          authorize(userId, draft.space_id, target),
        );
        if (decided.state !== "published") throw draftConflict(`Draft is ${decided.state}.`);
        return view(decided);
      } finally {
        publishing.delete(id);
      }
    },
    reject(userId: string, id: string) {
      const row = requireDraft(userId, id);
      if (row.state === "rejected") return view(row);
      if (row.state !== "pending") throw draftConflict(`Draft is ${row.state}.`);
      const decided = repository.decide(id, userId, "reject", now());
      if (decided.state !== "rejected") throw draftConflict(`Draft is ${decided.state}.`);
      return view(decided);
    },
    expireDue(time: number, limit: number) {
      return repository.expireDue(time, limit, [...receiving.keys(), ...publishing]);
    },
  };
}
