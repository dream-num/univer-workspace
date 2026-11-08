import {
  browseUrl,
  parseRepoReference,
  pullSpaceId,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { issueFeature, repoInput, resolveRepo } from "./issue-support.js";
import { spaceFeature, worktreeFeature } from "./pr-support.js";

const inputSchema = z.object({
  repo: repoInput,
  number: z
    .string()
    .optional()
    .describe(
      "Issue or pull request number (12 or #12), a Workspace URL, or a Worktree ID. Omit for the repository's page.",
    ),
  unit: z.string().optional().describe("Open this file (Unit ID) inside the pull request."),
});
export const browseTool: ToolDefinition = {
  name: "browse",
  toolset: "core",
  scope: "read",
  title: "Get Browser URL",
  description:
    "Return the Workspace Browser URL of a repository, Issue or pull request so the user can open it. A number is tried as a pull request first, then as an Issue.",
  inputSchema,
  outputSchema: z.object({ url: z.url() }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { repo, number, unit } = inputSchema.parse(args);
    let spaceId: string | null = null;
    const spaces = spaceFeature(context);
    const output = await browseUrl(
      {
        issues: issueFeature(context),
        origin: async () => context.identityOrigin,
        pullSpaceId: async (worktree) => {
          const found = await pullSpaceId(spaces, worktree);
          spaceId = found ?? spaceId;
          return found;
        },
        repo: async () => ({ spaceId: (spaceId = await resolveRepo(context, repo)) }),
        worktrees: worktreeFeature(context),
      },
      {
        ...(number === undefined ? {} : { argument: number }),
        ...(unit === undefined ? {} : { unit }),
      },
    );
    if (number !== undefined && /^https?:\/\//i.test(number.trim())) {
      const reference = parseRepoReference(number);
      if (reference.kind === "url") spaceId = reference.spaceId;
    }
    return { output, repo: spaceId };
  },
};
