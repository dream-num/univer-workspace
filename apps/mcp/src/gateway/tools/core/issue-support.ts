import {
  issueUrl,
  resolveItemTarget,
  resolveRepoReference,
  WorkspaceIssueFeature,
  WorkspaceSpaceFeature,
  workspaceError,
  type WorkspaceIssueSummary,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import type { ToolContext } from "../definition.js";

export const repoInput = z
  .string()
  .describe("Repository: owner/slug, owner/personal, a Space ID or a Workspace URL.");
export const numberInput = z
  .string()
  .describe(
    "Issue number (12 or #12) or the Issue's Workspace URL. A URL names its own repository and wins over repo.",
  );

export function issueFeature(context: ToolContext): WorkspaceIssueFeature {
  return new WorkspaceIssueFeature(async () => context.http);
}

export async function resolveRepo(context: ToolContext, repo: string): Promise<string> {
  const spaces = new WorkspaceSpaceFeature(async () => context.http);
  return (await resolveRepoReference(spaces, repo, context.identityOrigin)).spaceId;
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
