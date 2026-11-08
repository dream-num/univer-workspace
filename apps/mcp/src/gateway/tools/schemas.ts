import { z } from "zod";

export const repoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["personal", "team"]).optional(),
  accessRole: z.enum(["owner", "admin", "editor", "viewer"]).optional(),
  affiliation: z.enum(["owner", "member", "none"]).optional(),
  description: z.string().optional(),
  fullName: z.string().nullable().optional(),
  owner: z.object({ id: z.string(), username: z.string() }).optional(),
  publicRead: z.boolean().optional(),
  slug: z.string().nullable().optional(),
  url: z.url(),
});

const issueUserSchema = z.object({ displayName: z.string(), id: z.string(), username: z.string() });
const issueLabelSchema = z.object({
  color: z.string(),
  description: z.string(),
  id: z.string(),
  name: z.string(),
});
const issueReferenceSchema = z.object({
  available: z.boolean(),
  name: z.string().nullable(),
  nodeId: z.string(),
  resource: z
    .union([
      z.object({
        id: z.string(),
        kind: z.literal("univer"),
        unitId: z.string(),
        unitType: z.string(),
      }),
      z.object({ id: z.string(), kind: z.literal("blob"), mediaType: z.string() }),
    ])
    .nullable(),
});
const issueSummaryShape = {
  assignees: z.array(issueUserSchema),
  author: issueUserSchema,
  closedAt: z.string().nullable(),
  closedBy: issueUserSchema.nullable(),
  commentCount: z.number(),
  createdAt: z.string(),
  createdVia: z.enum(["browser", "agent", "unknown"]),
  id: z.string(),
  labels: z.array(issueLabelSchema),
  number: z.number(),
  referenceCount: z.number(),
  space: z.object({ id: z.string(), name: z.string() }),
  state: z.enum(["open", "closed"]),
  stateReason: z.enum(["completed", "not_planned"]).nullable(),
  title: z.string(),
  updatedAt: z.string(),
};
export const issueSummarySchema = z.object({ ...issueSummaryShape, url: z.url() });
export const issueSchema = z.object({
  ...issueSummaryShape,
  body: z.string(),
  capabilities: z.object({
    close: z.boolean(),
    comment: z.boolean(),
    edit: z.boolean(),
    triage: z.boolean(),
  }),
  references: z.array(issueReferenceSchema),
  url: z.url(),
});
export const issueCommentSchema = z.object({
  author: issueUserSchema,
  body: z.string(),
  createdAt: z.string(),
  id: z.string(),
  type: z.literal("comment"),
  updatedAt: z.string(),
});
export const issueTimelineItemSchema = z.union([
  issueCommentSchema,
  z.object({
    actor: issueUserSchema,
    createdAt: z.string(),
    id: z.string(),
    kind: z.string(),
    payload: z.record(z.string(), z.unknown()),
    type: z.literal("event"),
  }),
]);

const worktreeUnitSchema = z.object({
  activationState: z.enum([
    "notApplicable",
    "waitingForMerge",
    "pending",
    "completed",
    "failed",
    "discarded",
  ]),
  change: z.enum(["modified", "added", "deleted", "unchanged"]),
  draftHeadRevision: z.number(),
  mergeResult: z.enum(["pending", "merged", "unchanged", "conflict", "failed"]),
  name: z.string(),
  nodeId: z.string(),
  resourceId: z.string(),
  source: z.enum(["trunk", "worktree"]),
  target: z.object({ parentNodeId: z.string().nullable(), spaceId: z.string() }).nullable(),
  type: z.string(),
  unitId: z.string(),
  worktreeId: z.string(),
});
export const worktreeSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.enum(["draft", "ready", "merging", "merged", "discarded"]),
  units: z.array(worktreeUnitSchema),
  number: z.number().nullable().optional(),
  summary: z.string().nullable().optional(),
  spaceId: z.string().optional(),
  kind: z.enum(["user", "team"]).optional(),
  visibility: z.enum(["private", "space"]).optional(),
  creator: z.object({ id: z.string(), username: z.string() }).optional(),
  createdAt: z.string().optional(),
  createdVia: z.enum(["browser", "agent", "unknown"]).optional(),
  updatedAt: z.string().optional(),
  url: z.url(),
});
