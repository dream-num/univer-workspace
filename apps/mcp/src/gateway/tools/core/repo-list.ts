import {
  repoUrl,
  usernameKey,
  WorkspaceSpaceFeature,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";
import { repoSchema } from "../schemas.js";

const inputSchema = z.object({
  owner: z.string().optional(),
  type: z.enum(["team", "personal"]).optional(),
  limit: z.int().min(1).max(999999).default(30),
});
export const repoListTool: ToolDefinition = {
  name: "repo_list",
  toolset: "core",
  title: "List repositories",
  description: "List repositories you own or have joined, in Workspace order.",
  inputSchema,
  outputSchema: z.object({ repos: z.array(repoSchema) }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { owner: rawOwner, type, limit } = inputSchema.parse(args);
    const owner = rawOwner === undefined ? undefined : usernameKey(rawOwner);
    const spaces = new WorkspaceSpaceFeature(async () => context.http);
    const repos = (await spaces.list())
      .filter((space) => type === undefined || space.type === type)
      .filter(
        (space) =>
          owner === undefined ||
          (owner === "@me"
            ? (space.affiliation ?? space.accessRole) === "owner"
            : space.owner !== undefined && usernameKey(space.owner.username) === owner),
      )
      .slice(0, limit)
      .map((space) => ({ ...space, url: repoUrl(context.identityOrigin, space.id) }));
    return { output: { repos }, repo: null };
  },
};
