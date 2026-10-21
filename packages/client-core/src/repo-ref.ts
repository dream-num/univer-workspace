import { workspaceError } from "./errors.js";
import type { WorkspaceSpaceFeature } from "./space.js";

/** A repository reference as typed by a user, before any server lookup. */
export type WorkspaceRepoReference =
  | { readonly kind: "full-name"; readonly owner: string; readonly slug: string }
  | { readonly kind: "id"; readonly spaceId: string }
  | {
      readonly kind: "url";
      readonly spaceId: string;
      /** Set by `/issues/<n>` and `/pulls/<n>` URLs. */
      readonly item?: { readonly kind: "issue" | "pr"; readonly number: number };
    }
  | { readonly kind: "worktree-url"; readonly worktreeId: string };

export interface ResolvedWorkspaceRepo {
  readonly item?: { readonly kind: "issue" | "pr"; readonly number: number };
  readonly spaceId: string;
  /** Set when the reference named a Worktree by ID (legacy `/worktrees?worktree=<id>` link). */
  readonly worktreeId?: string;
}

const ITEM_ROUTES = { issues: "issue", pulls: "pr" } as const;

/**
 * Accepts `owner/slug`, `owner/personal`, a Space ID, or a Browser URL:
 * `/spaces/<id>[/issues|/pulls[/<n>]]` and the legacy `/worktrees?worktree=<id>`.
 */
export function parseRepoReference(text: string): WorkspaceRepoReference {
  const value = text.trim();
  if (value === "") throw invalid("Repository reference must not be empty.");
  if (/^https?:\/\//i.test(value)) return parseBrowserUrl(value);
  const parts = value.split("/");
  if (parts.length === 1) return { kind: "id", spaceId: value };
  if (parts.length === 2 && parts[0] !== "" && parts[1] !== "") {
    return { kind: "full-name", owner: parts[0]!, slug: parts[1]! };
  }
  throw invalid(`"${value}" is not owner/slug, a Space ID, or a Workspace URL.`);
}

/** Accepts `12`, `#12`, or an issue/pull Browser URL; returns undefined for anything else (e.g. an ID). */
export function parseItemNumber(text: string): number | undefined {
  const value = text.trim();
  const plain = /^#?([1-9]\d{0,9})$/.exec(value);
  if (plain) return Number(plain[1]);
  if (!/^https?:\/\//i.test(value)) return undefined;
  const reference = parseBrowserUrl(value);
  return reference.kind === "url" ? reference.item?.number : undefined;
}

/**
 * Turns a reference into a Space ID. `origin`, when given, rejects URLs of another Workspace.
 * The lookup asks the server, which also decides visibility: hidden and missing are both 404.
 */
export async function resolveRepoReference(
  spaces: Pick<WorkspaceSpaceFeature, "lookup">,
  reference: string | WorkspaceRepoReference,
  origin?: string,
): Promise<ResolvedWorkspaceRepo> {
  const parsed = typeof reference === "string" ? parseRepoReference(reference) : reference;
  if (origin !== undefined && typeof reference === "string" && /^https?:\/\//i.test(reference.trim())) {
    if (new URL(reference.trim()).origin !== new URL(origin).origin) {
      throw workspaceError(
        "workspace-origin-mismatch",
        "The URL belongs to a different Workspace than the configured origin.",
      );
    }
  }
  switch (parsed.kind) {
    case "id":
      return { spaceId: parsed.spaceId };
    case "url":
      return { spaceId: parsed.spaceId, ...(parsed.item === undefined ? {} : { item: parsed.item }) };
    case "worktree-url":
      throw workspaceError(
        "workspace-argument-invalid",
        "A Worktree link does not name a repository; pass it where a pull request is expected.",
        { worktreeId: parsed.worktreeId },
      );
    case "full-name":
      return { spaceId: (await spaces.lookup(parsed.owner, parsed.slug)).id };
  }
}

function parseBrowserUrl(value: string): WorkspaceRepoReference {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid(`"${value}" is not a valid URL.`);
  }
  const segments = url.pathname.split("/").filter((segment) => segment !== "").map(decodeURIComponent);
  if (segments[0] === "spaces" && segments[1] !== undefined) {
    const route = segments[2] as keyof typeof ITEM_ROUTES | undefined;
    const number = segments[3] !== undefined && /^[1-9]\d{0,9}$/.test(segments[3]) ? Number(segments[3]) : undefined;
    return {
      kind: "url",
      spaceId: segments[1],
      ...(route !== undefined && route in ITEM_ROUTES && number !== undefined
        ? { item: { kind: ITEM_ROUTES[route], number } }
        : {}),
    };
  }
  const worktreeId = segments[0] === "worktrees" ? url.searchParams.get("worktree") : null;
  if (worktreeId) return { kind: "worktree-url", worktreeId };
  throw invalid(`"${value}" is not a repository, issue, or pull request URL of this Workspace.`);
}

function invalid(message: string): Error {
  return workspaceError("workspace-argument-invalid", message);
}
