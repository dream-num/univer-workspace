import { TEAM_ROLES, workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { destructiveAnnotations, type ToolDefinition } from "../definition.js";
import { teamMemberSchema } from "../schemas.js";
import { repoInput, resolveRepo } from "../core/issue-support.js";
import { spaceFeature } from "../core/pr-support.js";

const inputSchema = z.object({
  repo: repoInput,
  action: z.enum(["add", "edit", "remove"]),
  user: z.string().describe("The user's username, which an agent has too, or user ID."),
  role: z.enum(TEAM_ROLES).optional().describe("Required for add and edit."),
});
export const repoMemberWriteTool: ToolDefinition = {
  name: "repo_member_write",
  toolset: "admin",
  agentToolsets: ["core", "admin"],
  scope: "publish",
  title: "Add, change or remove a repository member",
  description:
    "Takes effect immediately, without review. Add a user to a Team repository with a role (viewer reads, editor also writes, admin also manages members), change a member's role, or remove a member. Needs capabilities.manageMembers from repo_view. An agent can be admin only of a repository an agent owns, and an unclaimed agent can neither add members nor be one: those calls return AGENT_NOT_ALLOWED.",
  inputSchema,
  outputSchema: z.object({ ...teamMemberSchema.partial().shape, removed: z.string().optional() }),
  annotations: destructiveAnnotations,
  async run(context, args) {
    const { repo, action, user, role } = inputSchema.parse(args);
    if ((action === "remove") !== (role === undefined)) {
      throw workspaceError(
        "workspace-argument-invalid",
        action === "remove" ? "role does not apply to action remove." : `role is required for action ${action}.`,
      );
    }
    const spaceId = await resolveRepo(context, repo);
    const spaces = spaceFeature(context);
    const output =
      action === "add"
        ? await spaces.addMember(spaceId, user, role!)
        : action === "edit"
          ? await spaces.editMember(spaceId, user, role!)
          : await spaces.removeMember(spaceId, user);
    return { output, repo: spaceId };
  },
};
