import { z } from "zod";

export const reviewFindingSchema = z
  .object({
    rule: z.enum([
      "requires-shell",
      "requires-binary",
      "requires-local-io",
      "unavailable-tool",
      "suspicious-instruction",
    ]),
    path: z.string().min(1).max(1024),
    quote: z.string().min(1).max(200),
    impact: z.string().min(1).max(2000),
    suggestion: z.string().min(1).max(2000),
  })
  .strict();
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type VerifiedReviewFinding = ReviewFinding & { line: number; severity: "warn" };
export type StaticRule =
  | "frontmatter-invalid"
  | "reserved-name"
  | "size-limit"
  | "unsafe-path"
  | "text-too-large"
  | "script-file"
  | "facade-script"
  | "executable-binary"
  | "office-asset"
  | "media-asset"
  | "missing-reference"
  | "ignored-field"
  | "hidden-text"
  | "name-conflict"
  | "hub-verdict";
export interface ScanFinding {
  rule: StaticRule;
  severity: "block" | "warn" | "info";
  path: string;
  line: number | null;
  message: string;
}
export interface SkillFile {
  path: string;
  byteSize: number;
  sha256: string;
  kind: "text" | "binary";
  objectKey: string;
  mediaType: string;
}
export interface BaseFile {
  path: string;
  resourceId: string;
  etag: string;
}
export type SkillDraftState =
  | "receiving"
  | "pending"
  | "published"
  | "rejected"
  | "expired"
  | "conflicted";
export interface DraftRow {
  id: string;
  author_user_id: string;
  idempotency_key: string;
  intent_sha256: string;
  space_id: string;
  name: string;
  target_folder_node_id: string | null;
  files: string;
  base: string | null;
  keep: string;
  scan: string;
  review: string;
  source: string | null;
  unverified_review_count: number;
  state: SkillDraftState;
  result_folder_node_id: string | null;
  decided_by: string | null;
  decided_at: number | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
}
export interface SkillDraftView {
  id: string;
  kind: "create" | "replace";
  state: Exclude<SkillDraftState, "receiving">;
  name: string;
  spaceId: string;
  previewPath: string;
  files: Omit<SkillFile, "objectKey">[];
  base: BaseFile[] | null;
  keep: string[];
  removedPaths: string[];
  scan: ScanFinding[];
  review: VerifiedReviewFinding[];
  source: null;
  unverifiedReviewCount: number;
  compatibility: "ready" | "degraded" | "blocked";
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  published: { folderNodeId: string } | null;
}

export function draftFiles(row: DraftRow): SkillFile[] {
  return JSON.parse(row.files);
}
export function draftBase(row: DraftRow): BaseFile[] | null {
  return row.base === null ? null : JSON.parse(row.base);
}
export function draftKeep(row: DraftRow): string[] {
  return JSON.parse(row.keep);
}
