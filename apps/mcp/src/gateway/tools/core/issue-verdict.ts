import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { issueSchema } from "../schemas.js";
import { issueFeature, numberInput, repoInput, resolveIssue, withUrl } from "./issue-support.js";

const KINDS = { submit: "submitted", accept: "accepted", send_back: "sent_back" } as const;
const inputSchema = z.object({
  repo: repoInput,
  number: numberInput,
  verdict: z.enum(["submit", "accept", "send_back"]),
  body: z
    .string()
    .optional()
    .describe("Markdown. Required for submit (what you did, checked and assumed) and send_back (what is missing)."),
});
export const issueVerdictTool: ToolDefinition = {
  name: "issue_verdict",
  toolset: "core",
  scope: "write",
  title: "Submit, accept or send back Issue",
  description:
    "Hand finished work over on an open Issue. submit: an assignee, with any role, says the work is done. accept and send_back: whoever may close the Issue (its author or a triager, which may be you) answers a submitted Issue. accept closes it as completed; send_back returns it to the assignees, who submit again. Repeating the latest verdict with the same body changes nothing.",
  inputSchema,
  outputSchema: issueSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    const { repo, number, verdict, body } = inputSchema.parse(args);
    const target = await resolveIssue(context, repo, number);
    const issue = await issueFeature(context).verdict(target.spaceId, target.number, KINDS[verdict], body);
    return { output: withUrl(context, issue), repo: target.spaceId };
  },
};
