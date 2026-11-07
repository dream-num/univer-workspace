import { issueApiUsername } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { issueSchema } from "../schemas.js";
import { issueFeature, numberInput, repoInput, resolveIssue, withUrl } from "./issue-support.js";

const inputSchema = z.object({
  repo: repoInput,
  number: numberInput,
  title: z.string().optional(),
  body: z.string().optional().describe("Markdown; replaces the whole body."),
  add_labels: z.array(z.string()).optional(),
  remove_labels: z.array(z.string()).optional(),
  add_assignees: z.array(z.string()).optional().describe("Usernames or @me."),
  remove_assignees: z.array(z.string()).optional().describe("Usernames or @me."),
  add_nodes: z.array(z.string()).optional().describe("Node IDs of files to reference."),
  remove_nodes: z.array(z.string()).optional().describe("Node IDs of files to stop referencing."),
});
export const issueEditTool: ToolDefinition = {
  name: "issue_edit",
  toolset: "core",
  scope: "write",
  title: "Edit Issue",
  description:
    "Change an Issue's title, body, labels, assignees or referenced files. Needs at least one change.",
  inputSchema,
  outputSchema: issueSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    const input = inputSchema.parse(args);
    const target = await resolveIssue(context, input.repo, input.number);
    const issue = await issueFeature(context).update(target.spaceId, target.number, {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.add_labels === undefined ? {} : { addLabels: input.add_labels }),
      ...(input.remove_labels === undefined ? {} : { removeLabels: input.remove_labels }),
      ...(input.add_assignees === undefined
        ? {}
        : { addAssignees: input.add_assignees.map(issueApiUsername) }),
      ...(input.remove_assignees === undefined
        ? {}
        : { removeAssignees: input.remove_assignees.map(issueApiUsername) }),
      ...(input.add_nodes === undefined ? {} : { addNodes: input.add_nodes }),
      ...(input.remove_nodes === undefined ? {} : { removeNodes: input.remove_nodes }),
    });
    return { output: withUrl(context, issue), repo: target.spaceId };
  },
};
