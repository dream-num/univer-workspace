import { createHash } from "node:crypto";
import type { BlobStore } from "../../integrations/blob/blob-store.js";
import type { AccessResolver } from "../access/index.js";
import type { NodesRepository } from "../nodes/nodes.repository.js";
import type { WorktreeCheckRow } from "./worktrees.repository.js";
import type { WorktreeCheck, WorktreeChecksSummary, WorktreeUnit } from "./worktrees.types.js";

export const CHECK_NAME = /^[a-z0-9-]{1,40}$/;
const MAX_DECLARED = 20;
const MAX_CHECKS_FILE_BYTES = 64 * 1024;

/** The valid `## name` headings outside fenced code, first 20 in file order. Any other heading is text for agents. */
export function declaredCheckNames(text: string): string[] {
  const names: string[] = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced;
    const name = fenced ? undefined : /^##[ \t]+(.*?)[ \t]*$/.exec(line)?.[1];
    if (name !== undefined && CHECK_NAME.test(name) && !names.includes(name)) names.push(name);
    if (names.length === MAX_DECLARED) break;
  }
  return names;
}

/**
 * Names the content a result is about: every Unit's draft head, removal and Trunk head, and the pending page and
 * file drafts. Trunk head is the baseline plus the distance behind, so it adds no read beyond the freshness label.
 */
export function contentKey(units: readonly WorktreeUnit[], pendingDraftIds: readonly string[]): string {
  const parts = units
    .map((unit) => [
      unit.unitId,
      unit.draftHeadRevision,
      unit.change === "deleted",
      unit.freshness ? unit.freshness.baselineTrunkRevision + unit.freshness.revisionsBehind : null,
    ] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify([parts, [...pendingDraftIds].sort()])).digest("base64url");
}

export function checkViews(
  declared: readonly string[],
  rows: readonly WorktreeCheckRow[],
  currentKey: string | null,
  reporterMerges: ReadonlyMap<string, boolean>,
): WorktreeCheck[] {
  const undeclared = [...new Set(rows.map((row) => row.name))].filter((name) => !declared.includes(name)).sort();
  return [...declared, ...undeclared].map((name) => {
    const results = rows.filter((row) => row.name === name).map((row) => {
      const current = row.content_key === currentKey;
      return {
        reporter: {
          id: row.reporter_user_id,
          username: row.reporter_username,
          displayName: row.reporter_display_name,
          avatarUrl: row.reporter_avatar_url,
        },
        state: row.state,
        summary: row.summary,
        reportedAt: new Date(row.reported_at).toISOString(),
        current,
        counts: current && reporterMerges.get(row.reporter_user_id) === true,
      };
    });
    const counting = results.filter((result) => result.counts);
    return {
      name,
      declared: declared.includes(name),
      state: counting.some((result) => result.state === "failed")
        ? "failed"
        : counting.some((result) => result.state === "passed") ? "passed" : "missing",
      results,
    };
  });
}

export function checksSummary(checks: readonly WorktreeCheck[]): WorktreeChecksSummary {
  const declared = checks.filter((check) => check.declared);
  const count = (state: WorktreeCheck["state"]) => declared.filter((check) => check.state === state).length;
  return { passed: count("passed"), failed: count("failed"), missing: count("missing") };
}

/** Reads the declared names from Trunk's `.agents/checks.md` with the reader's own access; none when it cannot open exactly one. */
export function createDeclaredChecksReader(options: {
  readonly nodes: Pick<NodesRepository, "listChildren">;
  readonly access: AccessResolver;
  readonly store: BlobStore;
}): (userId: string, teamSpaceId: string) => Promise<readonly string[]> {
  async function onlyChild(spaceId: string, parentId: string | null, name: string): Promise<string | null> {
    // Children sort by case-folded name, so a cursor just before the name starts the page at it.
    const matches = (await options.nodes.listChildren(spaceId, parentId, { name, id: "" }, 20))
      .filter((node) => node.name === name);
    return matches.length === 1 ? matches[0]!.id : null;
  }
  return async (userId, teamSpaceId) => {
    const folder = await onlyChild(teamSpaceId, null, ".agents");
    const file = folder && await onlyChild(teamSpaceId, folder, "checks.md");
    const node = file ? await options.access.resolveNode(userId, file) : null;
    const resource = node?.resourceId ? await options.access.resolveResource(userId, node.resourceId) : null;
    if (resource?.kind !== "blob" || !resource.capabilities.openContent || resource.availability !== "ready" || resource.byteSize === 0) {
      return [];
    }
    const opened = await options.store.open({
      objectKey: resource.objectKey,
      start: 0,
      end: Math.min(resource.byteSize, MAX_CHECKS_FILE_BYTES) - 1,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return declaredCheckNames(Buffer.concat(chunks).toString("utf8"));
  };
}
