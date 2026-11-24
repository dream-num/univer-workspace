import {
  issueUrl,
  resolveItemTarget,
  resolveRepoOrFork,
  WorkspaceForkFeature,
  WorkspaceIssueFeature,
  WorkspaceSpaceFeature,
  workspaceError,
  type WorkspaceFork,
  type WorkspaceIssueSummary,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import type { ToolContext } from "../definition.js";

export const repoInput = z
  .string()
  .describe("Repository: owner/slug, owner/personal, a unique bare slug from repo_list, a Space ID or a Workspace URL.");
export const numberInput = z
  .string()
  .describe(
    "Issue number (12 or #12) or the Issue's Workspace URL. A URL names its own repository and wins over repo.",
  );

export function issueFeature(context: ToolContext): WorkspaceIssueFeature {
  return new WorkspaceIssueFeature(async () => context.http);
}

export const forkFeature = (context: ToolContext) => new WorkspaceForkFeature(async () => context.http);

export async function resolveRepoOrForkInput(context: ToolContext, repo: string) {
  const spaces = new WorkspaceSpaceFeature(async () => context.http);
  return await resolveRepoOrFork(spaces, forkFeature(context), repo, context.identityOrigin);
}

/** Refuses a fork address, so no tool that writes a repository's trunk can reach the upstream through a fork. */
export async function resolveRepo(context: ToolContext, repo: string): Promise<string> {
  const resolved = await resolveRepoOrForkInput(context, repo);
  if (!("fork" in resolved)) return resolved.spaceId;
  const { fork } = resolved;
  const upstream = fork.upstream?.fullName ?? fork.upstream?.id ?? "its upstream";
  const pull = fork.worktree?.number == null ? "" : ` Its pull request is #${String(fork.worktree.number)} in ${upstream}.`;
  throw workspaceError(
    "workspace-argument-invalid",
    `${fork.fullName} is a fork of ${upstream}, not a repository. Pass it as worktree to read and write its files, and as repo to space_browse or space_find to list them.${pull}`,
    { fork: fork.fullName, upstream },
  );
}

export async function resolveRepoOrUpstream(context: ToolContext, repo: string): Promise<string> {
  const resolved = await resolveRepoOrForkInput(context, repo);
  return "fork" in resolved ? upstreamOf(resolved.fork).id : resolved.spaceId;
}

export function upstreamOf(fork: WorkspaceFork) {
  if (fork.upstream !== null) return fork.upstream;
  throw workspaceError("workspace-not-found", `You can no longer read the upstream of fork ${fork.fullName}.`, {
    fork: fork.fullName,
  });
}

export async function resolveIssue(
  context: ToolContext,
  repo: string,
  number: string,
): Promise<{ readonly spaceId: string; readonly number: number }> {
  const target = await resolveItemTarget(
    number,
    "issue",
    async () => context.identityOrigin,
    async () => ({ spaceId: await resolveRepo(context, repo) }),
  );
  if (target.kind !== "number") {
    throw workspaceError("workspace-argument-invalid", "Expected an Issue number.");
  }
  return target;
}

export function withUrl<Issue extends WorkspaceIssueSummary>(
  context: ToolContext,
  issue: Issue,
): Issue & { readonly url: string } {
  return { ...issue, url: issueUrl(context.identityOrigin, issue.space.id, issue.number) };
}
