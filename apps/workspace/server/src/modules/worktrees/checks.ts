import { createHash } from "node:crypto";
import type { BlobStore } from "../../integrations/blob/blob-store.js";
import type { AccessResolver, BlobResourceAccess } from "../access/index.js";
import type { NodeCursor, NodesRepository } from "../nodes/nodes.repository.js";
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


export type ChecksDeclaration = { readonly names: readonly string[] } | { readonly problem: string };

const DECLARATION = ".agents/checks.md";
const SIBLING_PAGE = 100;
const MAX_SIBLING_PAGES = 10;

/**
 * Why the merge gate cannot use a declaration that `declaredCheckNames` reads leniently: a level-2 heading it would
 * drop, more than 20 names, a fence that never closes, or no name at all.
 */
export function declarationProblem(text: string): string | null {
  const names = new Set<string>();
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced || !/^\uFEFF? {0,3}##(?:[ \t]|$)/.test(line)) continue;
    if (line.startsWith("\uFEFF")) return `${DECLARATION} starts with a byte order mark, which hides its first heading.`;
    const name = /^##[ \t]+(.*?)[ \t]*$/.exec(line)?.[1];
    if (name === undefined || !CHECK_NAME.test(name)) {
      return `${DECLARATION} has a heading that is not a check name: ${JSON.stringify(line.trim())}. Name a check with lowercase letters, digits and hyphens after "## " at the start of a line, or use a level-3 heading for text.`;
    }
    if (names.has(name)) return `${DECLARATION} declares ${name} twice.`;
    names.add(name);
  }
  if (fenced) return `${DECLARATION} has a code fence that is never closed.`;
  if (names.size === 0) return `${DECLARATION} declares no checks.`;
  if (names.size > MAX_DECLARED) return `${DECLARATION} declares ${names.size} checks; at most ${MAX_DECLARED} are allowed.`;
  return null;
}

const asciiLower = (name: string) => name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/** Reads Trunk's `.agents/checks.md`: leniently for the check list, and strictly, as the server, for the merge gate. */
export function createDeclaredChecksReader(options: {
  readonly nodes: Pick<NodesRepository, "listChildren">;
  readonly access: AccessResolver;
  readonly store: BlobStore;
}) {
  /** The children named exactly `name`; null when more siblings than it reads differ from it only in case. */
  async function namedChildren(spaceId: string, parentId: string | null, name: string): Promise<string[] | null> {
    const ids: string[] = [];
    // Children sort by ASCII case-folded name, so a cursor just before the name starts the page at it.
    let cursor: NodeCursor = { name, id: "" };
    for (let page = 0; page < MAX_SIBLING_PAGES; page++) {
      const rows = await options.nodes.listChildren(spaceId, parentId, cursor, SIBLING_PAGE);
      ids.push(...rows.filter((row) => row.name === name).map((row) => row.id));
      const last = rows.at(-1);
      if (rows.length < SIBLING_PAGE || !last || asciiLower(last.name) !== asciiLower(name)) return ids;
      cursor = last;
    }
    return null;
  }

  function onlyOne(ids: string[] | null, what: string): string {
    if (ids?.length === 1) return ids[0]!;
    throw new DeclarationProblem(ids?.length === 0 ? `Trunk has no ${DECLARATION}.` : `Trunk has more than one ${what}.`);
  }

  async function declarationFile(userId: string, spaceId: string): Promise<BlobResourceAccess> {
    const folder = onlyOne(await namedChildren(spaceId, null, ".agents"), "folder named .agents");
    const file = onlyOne(await namedChildren(spaceId, folder, "checks.md"), DECLARATION);
    const node = await options.access.resolveNode(userId, file);
    const resource = node?.resourceId ? await options.access.resolveResource(userId, node.resourceId) : null;
    if (resource?.kind !== "blob" || !resource.capabilities.openContent) throw new DeclarationProblem(`${DECLARATION} on Trunk is not a file that can be read.`);
    if (resource.availability !== "ready") throw new DeclarationProblem(`${DECLARATION} on Trunk is not ready to read.`);
    if (resource.byteSize === 0) throw new DeclarationProblem(`${DECLARATION} on Trunk is empty.`);
    return resource;
  }

  async function text(resource: BlobResourceAccess): Promise<string> {
    const opened = await options.store.open({
      objectKey: resource.objectKey,
      start: 0,
      end: Math.min(resource.byteSize, MAX_CHECKS_FILE_BYTES) - 1,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }

  return {
    /** The declared names as the user can read them; none when they cannot open exactly one declaration. */
    async names(userId: string, teamSpaceId: string): Promise<readonly string[]> {
      try {
        return declaredCheckNames(await text(await declarationFile(userId, teamSpaceId)));
      } catch (error) {
        if (error instanceof DeclarationProblem) return [];
        throw error;
      }
    },
    /** The declaration the merge gate holds an agent to, read as the Space owner, which reads every file of its Space. */
    async gate(teamSpaceId: string, ownerUserId: string): Promise<ChecksDeclaration> {
      try {
        const resource = await declarationFile(ownerUserId, teamSpaceId);
        if (resource.byteSize > MAX_CHECKS_FILE_BYTES) throw new DeclarationProblem(`${DECLARATION} on Trunk is larger than 64 KiB.`);
        const content = await text(resource).catch(() => {
          throw new DeclarationProblem(`${DECLARATION} on Trunk cannot be read.`);
        });
        const problem = declarationProblem(content);
        return problem ? { problem } : { names: declaredCheckNames(content) };
      } catch (error) {
        if (error instanceof DeclarationProblem) return { problem: error.message };
        throw error;
      }
    },
  };
}

export type DeclaredChecksReader = ReturnType<typeof createDeclaredChecksReader>;

class DeclarationProblem extends Error {}
