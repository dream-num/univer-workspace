import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";

export const skillReviewFindingSchema = z.strictObject({
  rule: z.enum(["requires-shell", "requires-binary", "requires-local-io", "unavailable-tool", "suspicious-instruction"]),
  path: z.string().min(1).max(1024),
  quote: z.string().min(1).max(200),
  impact: z.string().min(1).max(2000),
  suggestion: z.string().min(1).max(2000),
});

export const resolvedSkillSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("git"), hub: z.enum(["github", "skills-sh"]), owner: z.string().min(1), repo: z.string().min(1), commit: z.string().regex(/^[a-f0-9]{40}$/), path: z.string().max(1024), pageUrl: z.string().max(2048) }),
  z.strictObject({ kind: z.literal("clawhub"), owner: z.string().min(1), slug: z.string().min(1), version: z.string().min(1), pageUrl: z.string().max(2048) }),
  z.strictObject({ kind: z.literal("space"), nodeId: z.uuid(), etag: z.string().min(1).max(100) }),
]);

export const skillScanSchema = z.array(z.object({
    rule: z.enum(["frontmatter-invalid", "reserved-name", "size-limit", "unsafe-path", "text-too-large", "script-file", "facade-script", "executable-binary", "office-asset", "media-asset", "missing-reference", "ignored-field", "hidden-text", "name-conflict", "hub-verdict"]),
    severity: z.enum(["block", "warn", "info"]), path: z.string(),
    line: z.number().int().positive().nullable(), message: z.string(),
  }));

const draftSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["create", "replace"]),
  state: z.enum(["pending", "published", "rejected", "expired", "conflicted"]),
  name: z.string(),
  spaceId: z.string().min(1),
  previewPath: z.string(),
  files: z.array(z.object({
    path: z.string(), byteSize: z.number().int().nonnegative(), sha256: z.string(),
    kind: z.enum(["text", "binary"]), mediaType: z.string(),
  })),
  base: z.array(z.object({ path: z.string(), resourceId: z.string(), etag: z.string() })).nullable(),
  keep: z.array(z.string()),
  removedPaths: z.array(z.string()),
  scan: skillScanSchema,
  review: z.array(skillReviewFindingSchema.extend({ line: z.number().int().positive(), severity: z.literal("warn") })),
  source: resolvedSkillSourceSchema.nullable(),
  unverifiedReviewCount: z.number().int().nonnegative(),
  compatibility: z.enum(["ready", "degraded", "blocked"]),
  createdAt: z.string(),
  expiresAt: z.string(),
  decidedAt: z.string().nullable(),
  published: z.object({ folderNodeId: z.string() }).nullable(),
});

export const skillDraftOutput = z.object({ draft: draftSchema.omit({ previewPath: true }).extend({ previewUrl: z.url() }) });

export function skillDraftResult(value: unknown, origin: string, expectedId?: string) {
  const result = draftSchema.safeParse(value);
  if (!result.success) throw workspaceError("workspace-invalid-response", "Workspace returned an invalid Skill draft.");
  const { previewPath, ...draft } = result.data;
  if (expectedId !== undefined && draft.id !== expectedId) {
    throw workspaceError("workspace-result-mismatch", "Skill draft ID does not match the request.");
  }
  if (previewPath !== `/drafts/skills/${encodeURIComponent(draft.id)}`) {
    throw workspaceError("workspace-invalid-response", "Workspace returned an invalid Skill draft preview path.");
  }
  return { ...draft, previewUrl: new URL(previewPath, origin).href };
}
