/**
 * Team Space Issue contracts for the Workspace API.
 *
 * Results are compacted for the model: users become display names and timeline
 * events become one-line details. Full-fidelity clients (Browser, CLI) read the
 * same endpoints directly.
 * @module dsh-univer-workspace-plugin/provider/issues-api
 */

import type { WorkspaceHttpClient } from "./workspace-contract.ts";
import { WorkspaceApiError, readJson } from "./api-errors.ts";

export interface IssueReferenceView {
  readonly nodeId: string;
  readonly available: boolean;
  readonly name: string | null;
  /** Present for a Univer file; pass it to `univer_open` or `univer_worktree`. */
  readonly resourceId: string | null;
  readonly kind: "univer" | "blob" | null;
}

export interface IssueSummaryView {
  readonly number: number;
  readonly space: { readonly id: string; readonly name: string };
  readonly title: string;
  readonly state: "open" | "closed";
  readonly stateReason: "completed" | "not_planned" | null;
  readonly author: string;
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  readonly commentCount: number;
  readonly referenceCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IssueTimelineEntry {
  readonly type: "comment" | "event";
  readonly author: string;
  readonly at: string;
  /** Markdown for a comment; a one-line description for an event. */
  readonly text: string;
}

export interface IssueDetailView extends IssueSummaryView {
  readonly body: string;
  readonly references: readonly IssueReferenceView[];
  readonly timeline: readonly IssueTimelineEntry[];
  readonly capabilities: { readonly edit: boolean; readonly triage: boolean; readonly comment: boolean };
}

/** The whole-set relations of an Issue, needed to turn "add X" into a full-set PATCH. */
export interface IssueSets {
  readonly labelIds: readonly string[];
  readonly assigneeUserIds: readonly string[];
  readonly nodeIds: readonly string[];
}

export interface IssueListView {
  readonly issues: readonly IssueSummaryView[];
  readonly counts: { readonly open: number; readonly closed: number };
  readonly nextCursor: string | null;
}

export interface ListIssuesQuery {
  /** Omit to list across every Team Space the user belongs to. */
  readonly spaceId?: string;
  readonly state?: "open" | "closed" | "all";
  readonly labels?: readonly string[];
  readonly assignee?: string;
  readonly author?: string;
  readonly search?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface IssueChange {
  readonly title?: string;
  readonly body?: string;
  readonly state?: "open" | "closed";
  readonly stateReason?: "completed" | "not_planned";
  readonly labelIds?: readonly string[];
  readonly assigneeUserIds?: readonly string[];
  readonly nodeIds?: readonly string[];
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WorkspaceApiError(`workspace ${what} response is malformed`, 502, "WORKSPACE_RESPONSE_INVALID");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new WorkspaceApiError(`workspace ${what} response is malformed`, 502, "WORKSPACE_RESPONSE_INVALID");
  }
  return value;
}

function person(value: unknown): string {
  const user = (value ?? {}) as Record<string, unknown>;
  return typeof user.displayName === "string" && user.displayName
    ? user.displayName
    : typeof user.username === "string"
      ? user.username
      : "unknown";
}

export function narrowIssueSummary(raw: unknown): IssueSummaryView {
  const issue = record(raw, "issue");
  const space = record(issue.space, "issue");
  if (
    typeof issue.number !== "number" ||
    typeof issue.title !== "string" ||
    (issue.state !== "open" && issue.state !== "closed") ||
    typeof space.id !== "string" ||
    typeof space.name !== "string"
  ) {
    throw new WorkspaceApiError("workspace issue response is malformed", 502, "WORKSPACE_RESPONSE_INVALID");
  }
  const stateReason =
    issue.stateReason === "completed" || issue.stateReason === "not_planned" ? issue.stateReason : null;
  return {
    number: issue.number,
    space: { id: space.id, name: space.name },
    title: issue.title,
    state: issue.state,
    stateReason,
    author: person(issue.author),
    labels: array(issue.labels, "issue").map((label) => String((label as Record<string, unknown>).name)),
    assignees: array(issue.assignees, "issue").map(person),
    commentCount: typeof issue.commentCount === "number" ? issue.commentCount : 0,
    referenceCount: typeof issue.referenceCount === "number" ? issue.referenceCount : 0,
    createdAt: String(issue.createdAt),
    updatedAt: String(issue.updatedAt),
  };
}

function narrowReference(raw: unknown): IssueReferenceView {
  const reference = record(raw, "issue reference");
  const resource = (reference.resource ?? null) as Record<string, unknown> | null;
  return {
    nodeId: String(reference.nodeId),
    available: reference.available === true,
    name: typeof reference.name === "string" ? reference.name : null,
    resourceId: resource && typeof resource.id === "string" ? resource.id : null,
    kind: resource?.kind === "univer" || resource?.kind === "blob" ? resource.kind : null,
  };
}

export function describeEvent(kind: string, payload: Record<string, unknown>): string {
  const name = (key = "name") => (typeof payload[key] === "string" ? String(payload[key]) : "?");
  switch (kind) {
    case "closed":
      return payload.reason === "not_planned" ? "closed as not planned" : "closed as completed";
    case "reopened":
      return "reopened";
    case "renamed":
      return `renamed from "${name("from")}" to "${name("to")}"`;
    case "labeled":
      return `added label ${name()}`;
    case "unlabeled":
      return `removed label ${name()}`;
    case "assigned":
      return `assigned ${name("displayName")}`;
    case "unassigned":
      return `unassigned ${name("displayName")}`;
    case "node_referenced":
      return `linked file ${name()}`;
    case "node_unreferenced":
      return `unlinked file ${name()}`;
    default:
      return kind;
  }
}

function narrowTimeline(raw: unknown): IssueTimelineEntry[] {
  return array(record(raw, "issue timeline").items, "issue timeline").map((item) => {
    const entry = record(item, "issue timeline");
    if (entry.type === "comment") {
      return {
        type: "comment" as const,
        author: person(entry.author),
        at: String(entry.createdAt),
        text: String(entry.body),
      };
    }
    return {
      type: "event" as const,
      author: person(entry.actor),
      at: String(entry.createdAt),
      text: describeEvent(String(entry.kind), (entry.payload ?? {}) as Record<string, unknown>),
    };
  });
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  };
}

function spacePath(spaceId: string): string {
  return `/api/spaces/${encodeURIComponent(spaceId)}`;
}

export async function listIssues(
  client: WorkspaceHttpClient,
  query: ListIssuesQuery,
): Promise<IssueListView> {
  const params = new URLSearchParams();
  if (query.state) params.set("state", query.state);
  for (const label of query.labels ?? []) params.append("label", label);
  if (query.assignee) params.set("assignee", query.assignee);
  if (query.author) params.set("author", query.author);
  if (query.search) params.set("q", query.search);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  const base = query.spaceId ? `${spacePath(query.spaceId)}/issues` : "/api/issues";
  const raw = record(
    await readJson(await client.request(`${base}${params.size ? `?${params}` : ""}`), "issues list"),
    "issues list",
  );
  const counts = record(raw.counts, "issues list");
  return {
    issues: array(raw.items, "issues list").map(narrowIssueSummary),
    counts: { open: Number(counts.open), closed: Number(counts.closed) },
    nextCursor: typeof raw.nextCursor === "string" ? raw.nextCursor : null,
  };
}

/**
 * Read an Issue, optionally with its whole discussion (comments and events). `sets` carries the
 * IDs the compact view drops, so a caller can send a full-set PATCH.
 */
export async function readIssue(
  client: WorkspaceHttpClient,
  spaceId: string,
  number: number,
  options: { readonly timeline: boolean },
): Promise<{ readonly view: IssueDetailView; readonly sets: IssueSets }> {
  const path = `${spacePath(spaceId)}/issues/${number}`;
  const issue = record(await readJson(await client.request(path), "issue get"), "issue");
  const timeline: IssueTimelineEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; options.timeline && page < 25; page += 1) {
    const query = new URLSearchParams({ limit: "200", ...(cursor ? { cursor } : {}) });
    const raw = await readJson(await client.request(`${path}/timeline?${query}`), "issue timeline");
    timeline.push(...narrowTimeline(raw));
    const next = (raw as Record<string, unknown>).nextCursor;
    if (typeof next !== "string") break;
    cursor = next;
  }
  const capabilities = record(issue.capabilities, "issue");
  const references = array(issue.references, "issue").map(narrowReference);
  return {
    view: {
      ...narrowIssueSummary(issue),
      body: typeof issue.body === "string" ? issue.body : "",
      references,
      timeline,
      capabilities: {
        edit: capabilities.edit === true,
        triage: capabilities.triage === true,
        comment: capabilities.comment === true,
      },
    },
    sets: {
      labelIds: array(issue.labels, "issue").map((label) => String((label as Record<string, unknown>).id)),
      assigneeUserIds: array(issue.assignees, "issue").map((user) => String((user as Record<string, unknown>).id)),
      nodeIds: references.map((reference) => reference.nodeId),
    },
  };
}

export async function createIssue(
  client: WorkspaceHttpClient,
  spaceId: string,
  input: IssueChange & { readonly title: string },
): Promise<IssueSummaryView> {
  return narrowIssueSummary(
    await readJson(await client.request(`${spacePath(spaceId)}/issues`, json("POST", input)), "issue create"),
  );
}

export async function updateIssue(
  client: WorkspaceHttpClient,
  spaceId: string,
  number: number,
  change: IssueChange,
): Promise<IssueSummaryView> {
  return narrowIssueSummary(
    await readJson(
      await client.request(`${spacePath(spaceId)}/issues/${number}`, json("PATCH", change)),
      "issue update",
    ),
  );
}

export async function commentOnIssue(
  client: WorkspaceHttpClient,
  spaceId: string,
  number: number,
  body: string,
): Promise<{ readonly id: string }> {
  const raw = record(
    await readJson(
      await client.request(`${spacePath(spaceId)}/issues/${number}/comments`, json("POST", { body })),
      "issue comment",
    ),
    "issue comment",
  );
  return { id: String(raw.id) };
}

export async function listIssueLabels(
  client: WorkspaceHttpClient,
  spaceId: string,
): Promise<readonly { readonly id: string; readonly name: string }[]> {
  const raw = record(
    await readJson(await client.request(`${spacePath(spaceId)}/issue-labels`), "issue labels"),
    "issue labels",
  );
  return array(raw.labels, "issue labels").map((label) => {
    const value = record(label, "issue labels");
    return { id: String(value.id), name: String(value.name) };
  });
}
