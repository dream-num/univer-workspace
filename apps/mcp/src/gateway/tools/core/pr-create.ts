import { pullRequestSpace } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { worktreeSchema } from "../schemas.js";
import { repoInput, resolveRepo } from "./issue-support.js";
import { prWithUrl, spaceFeature, visibilityInput, worktreeFeature } from "./pr-support.js";

const inputSchema = z.object({
  repo: repoInput,
  title: z.string(),
  body: z.string().optional().describe("Markdown."),
  visibility: visibilityInput.optional(),
  idempotency_key: z
    .string()
    .optional()
    .describe("Retry-safe key for this creation; reuse the same key when retrying."),
});
export const prCreateTool: ToolDefinition = {
  name: "pr_create",
  toolset: "core",
  scope: "write",
  title: "Create pull request",
  description:
    "Open a draft pull request in a repository; add its files with the file tools. Generate an idempotency_key before creating and reuse it on retry, so a retry returns the same pull request instead of a duplicate.",
  inputSchema,
  outputSchema: worktreeSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    const { repo, title, body, visibility, idempotency_key } = inputSchema.parse(args);
    const space = await pullRequestSpace(
      spaceFeature(context),
      async () => context.user.id,
      await resolveRepo(context, repo),
    );
    const worktree = await worktreeFeature(context).create({
      name: title,
      scope: space.type === "personal" ? { kind: "user" } : { kind: "space", spaceId: space.id },
      ...(body === undefined ? {} : { summary: body }),
      ...(idempotency_key === undefined ? {} : { idempotencyKey: idempotency_key }),
      ...(visibility === undefined ? {} : { visibility }),
    });
    return { output: prWithUrl(context, worktree, space.id), repo: space.id };
  },
};
