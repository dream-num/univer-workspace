import { SPACE_PROPOSALS, TEAM_ROLES } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";

export const IDEMPOTENCY_KEY_DESCRIPTION =
  "Generate a new random value, such as a UUID, for each new operation. Reuse it only to retry the same call with identical arguments. Never derive it from names or reuse a key from earlier work.";

export const proposalsSchema = z
  .enum(SPACE_PROPOSALS)
  .describe(
    "Who besides members may fork a Team repository and propose, while it is public: members (no one else), accountable (also any person or claimed agent), anyone (also unclaimed agents).",
  );

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
  proposals: proposalsSchema.optional(),
  acceptAfterHours: z
    .number()
    .nullable()
    .optional()
    .describe("Hours after a submission at which an Issue nobody sent back is accepted by deadline; null when off."),
  slug: z.string().nullable().optional(),
  capabilities: z
    .record(z.string(), z.boolean())
    .optional()
    .describe(
      "What you may do in this repository. manageMembers: add, change and remove members. propose: fork it and open pull requests in it.",
    ),
  url: z.url(),
});

const issueUserSchema = z.object({ displayName: z.string(), id: z.string(), username: z.string() });
export const teamMemberSchema = z.object({
  user: issueUserSchema,
  role: z.enum(TEAM_ROLES),
  grantedBy: issueUserSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const issueLabelSchema = z.object({
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
  pullRequests: z
    .array(
      z.object({
        author: issueUserSchema,
        id: z.string(),
        mergedBy: issueUserSchema.nullable(),
        number: z.number().nullable(),
        state: z.enum(["draft", "ready", "merging", "merged", "discarded"]),
        title: z.string(),
      }),
    )
    .describe("Pull requests linked to this Issue that you may see, newest first."),
  acceptance: z
    .object({
      kind: z.string(),
      actor: issueUserSchema.nullable(),
      body: z.string(),
      createdAt: z.string(),
      deadline: z.string().nullable().describe("When the repository's deadline accepts this submitted Issue unless it is sent back, or null."),
    })
    .nullable()
    .describe(
      "Latest verdict (submitted, accepted or sent_back) with its body, or null if never submitted. A null actor means the repository's deadline accepted it.",
    ),
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
    actor: issueUserSchema.nullable().describe("Null for an acceptance by the repository's deadline."),
    createdAt: z.string(),
    id: z.string(),
    kind: z.string(),
    payload: z.record(z.string(), z.unknown()),
    type: z.literal("event"),
  }),
]);

export const unitSchema = z.object({
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
  freshness: z
    .object({
      addedAt: z.string(),
      baselineTrunkRevision: z.number(),
      label: z.enum(["current", "behind", "stale"]),
      revisionsBehind: z.number(),
    })
    .nullable()
    .describe(
      "How far trunk moved since this trunk file joined the pull request. Null for a new file and once the pull request is no longer draft or ready. current: trunk has not moved. behind: trunk changed the file since, within the limits. stale: more than 100 revisions behind, or added more than 7 days ago. The server instructions say what to do with each; none of them blocks a merge.",
    ),
  mergeResult: z
    .enum(["pending", "merged", "unchanged", "removed", "conflict", "failed"])
    .describe("removed: the pull request deleted this file."),
  name: z.string(),
  nodeId: z.string().nullable().describe("Null once the file is permanently deleted."),
  resourceId: z.string(),
  source: z.enum(["trunk", "worktree"]),
  target: z.object({ parentNodeId: z.string().nullable(), spaceId: z.string() }).nullable(),
  type: z.string(),
  unitId: z.string(),
  worktreeId: z.string(),
});
export const unitWithUrlSchema = unitSchema.extend({ url: z.url() });
export const worktreeSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.enum(["draft", "ready", "merging", "merged", "discarded"]),
  units: z.array(unitSchema),
  number: z.number().nullable().optional(),
  summary: z.string().nullable().optional(),
  spaceId: z.string().optional(),
  kind: z.enum(["user", "team"]).optional(),
  visibility: z.enum(["private", "space"]).optional(),
  creator: z.object({ id: z.string(), username: z.string() }).optional(),
  createdAt: z.string().optional(),
  createdVia: z.enum(["browser", "agent", "unknown"]).optional(),
  updatedAt: z.string().optional(),
  capabilities: z
    .object({
      review: z.boolean(),
      editDraft: z.boolean(),
      addUnit: z.boolean(),
      changeVisibility: z.boolean(),
      markReady: z.boolean(),
      reopen: z.boolean(),
      merge: z.boolean(),
      discard: z.boolean(),
    })
    .optional()
    .describe("What you may do with this pull request now."),
  issue: z
    .object({ number: z.number(), title: z.string(), state: z.enum(["open", "closed"]) })
    .nullable()
    .optional()
    .describe("The Issue this pull request serves; null when none is linked."),
  checks: z
    .object({ passed: z.number(), failed: z.number(), missing: z.number() })
    .nullable()
    .optional()
    .describe("How many declared checks pass, fail, or lack a result that counts. pr_view lists them."),
  url: z.url(),
});

export const checkSchema = z.object({
  name: z.string(),
  declared: z.boolean().describe("Declared in trunk's `.agents/checks.md`. Other reported names are not required."),
  state: z
    .enum(["passed", "failed", "missing"])
    .describe("failed if a counting result failed, passed if one passed and none failed, otherwise missing."),
  results: z
    .array(
      z.object({
        reporter: z.object({ id: z.string(), username: z.string(), displayName: z.string() }),
        state: z.enum(["passed", "failed"]),
        summary: z.string(),
        reportedAt: z.string(),
        current: z.boolean().describe("Reported on the content the pull request has now, or merged with."),
        counts: z.boolean().describe("Current, and reported by someone who may merge the pull request."),
      }),
    )
    .describe("Newest first."),
});

export const forkPullSchema = worktreeSchema
  .omit({ units: true })
  .nullable()
  .describe("The fork's open pull request in its upstream; null while the fork is clean.");
export const forkSchema = z.object({
  id: z.string(),
  name: z.string(),
  fullName: z.string().describe("The fork address <owner>/<name>."),
  owner: z.object({ id: z.string(), username: z.string() }),
  upstream: repoSchema.nullable().describe("The repository the fork views; null once you can no longer read it."),
  state: z
    .enum(["clean", "drafting", "proposed", "merging"])
    .describe(
      "clean: no open pull request, the next write opens one. drafting: writes join the draft. proposed: ready, writes fail until pr_ready with undo true. merging: writes fail until the merge finishes.",
    ),
  worktree: forkPullSchema,
  createdAt: z.string(),
});

const resourceCapabilitiesSchema = z.object({
  downloadContent: z.boolean(),
  editContent: z.boolean(),
  openContent: z.boolean(),
});
export const blobResourceSchema = z.object({
  availability: z.enum(["ready", "quarantined"]),
  byteSize: z.number(),
  capabilities: resourceCapabilitiesSchema,
  kind: z.literal("blob"),
  mediaType: z.string(),
  resourceId: z.string(),
});
const nodeShape = {
  accessRole: z.enum(["owner", "admin", "editor", "viewer"]),
  capabilities: z.object({
    browseChildren: z.boolean(),
    createChildren: z.boolean(),
    move: z.boolean(),
    rename: z.boolean(),
    share: z.boolean(),
    trash: z.boolean(),
  }),
  hasChildren: z.boolean(),
  name: z.string(),
  nodeId: z.string(),
  parentNodeId: z.string().nullable(),
  resource: z
    .union([
      z.object({
        capabilities: resourceCapabilitiesSchema,
        kind: z.literal("univer"),
        resourceId: z.string(),
        unitId: z.string(),
        unitType: z.string(),
      }),
      blobResourceSchema,
    ])
    .nullable(),
  spaceId: z.string(),
  updatedAt: z.string(),
  url: z.url(),
};
export const nodeSummarySchema = z.object(nodeShape);
export const nodeSchema = z.object({ ...nodeShape, path: z.string() });

const trashBlockerSchema = z
  .union([
    z.object({
      code: z.enum(["RESTORE_PARENT_IN_TRASH", "NESTED_TRASH_BATCH"]),
      trashBatchId: z.string(),
    }),
    z.object({ code: z.literal("ACTIVE_WORKTREE_RESOURCE_REFERENCE") }),
  ])
  .nullable();
export const trashBatchSchema = z.object({
  capabilities: z.object({ removePermanently: z.boolean(), restore: z.boolean() }),
  nodeCount: z.number(),
  originalLocation: z.object({
    breadcrumbs: z.array(z.object({ name: z.string(), nodeId: z.string() })),
  }),
  removeBlockedBy: trashBlockerSchema,
  restoreBlockedBy: trashBlockerSchema,
  root: z.object({
    name: z.string(),
    nodeId: z.string(),
    resource: z
      .union([
        z.object({ kind: z.literal("univer"), resourceId: z.string(), unitType: z.string() }),
        z.object({
          byteSize: z.number(),
          kind: z.literal("blob"),
          mediaType: z.string(),
          resourceId: z.string(),
        }),
      ])
      .nullable(),
  }),
  spaceId: z.string(),
  trashBatchId: z.string(),
  trashedAt: z.string(),
  trashedBy: z.object({
    avatarUrl: z.string().nullable(),
    id: z.string(),
    name: z.string(),
    username: z.string(),
  }),
});
export const labelUsageSchema = issueLabelSchema.extend({ openIssueCount: z.number() });
