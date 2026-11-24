import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { forkSchema } from "../schemas.js";
import { forkWithUrls } from "./fork-support.js";
import { forkFeature, repoInput, resolveRepo } from "./issue-support.js";

const inputSchema = z.object({
  repo: repoInput.describe(
    "The Team repository to fork: owner/slug, a unique bare slug from repo_list, a Space ID or a Workspace URL.",
  ),
  name: z
    .string()
    .describe(
      "Fork name: letters, digits, '.', '_' and '-', unique among your forks and repositories. The fork's address is <your username>/<name>.",
    ),
});
export const forkCreateTool: ToolDefinition = {
  name: "fork_create",
  toolset: "core",
  scope: "write",
  title: "Fork a Team repository",
  description:
    "Fork a Team repository you may propose to, as capabilities.propose from repo_view says: a member may, and a public repository's proposals setting decides for anyone else. A fork is your own view of all its files, named <you>/<name>, that copies nothing. Pass that address as worktree to content tools and as repo to space_browse and space_find. The first write through it opens a pull request in the repository, and later writes join it. upstream.accessRole says whether you can merge it. Creating the same fork again returns it.",
  inputSchema,
  outputSchema: forkSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    const { repo, name } = inputSchema.parse(args);
    const fork = await forkFeature(context).create({ name, upstreamSpaceId: await resolveRepo(context, repo) });
    return { output: forkWithUrls(context, fork), repo: fork.upstream?.id ?? null };
  },
};
