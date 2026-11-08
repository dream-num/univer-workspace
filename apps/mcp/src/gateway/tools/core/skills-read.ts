import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { pageText, RESULT_LIMIT } from "../../paging.js";
import { getSkill, listSkills, readSkillResource } from "../../skills.js";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";

const inputSchema = z.object({
  name: z.string().min(1).optional().describe("Skill name. Omit it to list every skill."),
  resource: z
    .string()
    .min(1)
    .optional()
    .describe(
      "A reference or template path listed by the skill, such as references/markdown.md. Needs name.",
    ),
  full: z
    .boolean()
    .optional()
    .describe("With name only: include every reference and template of the skill."),
  cursor: z
    .string()
    .optional()
    .describe(
      "The cursor of a truncated resource. Repeat the call with the same arguments to continue.",
    ),
});
const invalid = (message: string) => workspaceError("workspace-argument-invalid", message);

export const skillsReadTool: ToolDefinition = {
  name: "skills_read",
  toolset: "core",
  scope: "read",
  title: "Read Skills",
  description:
    "Read the version-matched operational Skills that teach the Workspace workflow. Without arguments it lists the skills. With name it returns that skill (with full: true also its references and templates). With name and resource it returns one reference or template. A long resource has truncated: true and a cursor; call again with the same arguments and that cursor to continue.",
  inputSchema,
  outputSchema: z.object({
    skills: z
      .array(
        z.object({
          name: z.string(),
          description: z.string().optional(),
          content: z.string().optional(),
          resources: z.array(z.object({ path: z.string(), readCommand: z.string() })).optional(),
          files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
        }),
      )
      .optional(),
    name: z.string().optional(),
    path: z.string().optional(),
    content: z.string().optional(),
    truncated: z.boolean().optional(),
    cursor: z.string().optional(),
  }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { name, resource, full, cursor } = inputSchema.parse(args);
    const root = context.skillDataRoot;
    if (name === undefined) {
      if (resource !== undefined || full !== undefined || cursor !== undefined) {
        throw invalid("resource, full and cursor need a skill name.");
      }
      return { output: { skills: await listSkills(root) }, repo: null };
    }
    if (resource !== undefined) {
      if (full !== undefined) throw invalid("full applies only when resource is omitted.");
      const read = await readSkillResource(root, name, resource);
      return {
        output: pageText("skills_read", { name, resource }, cursor, read.content, (content) => ({
          name: read.name,
          path: read.path,
          content,
        })),
        repo: null,
      };
    }
    if (cursor !== undefined) throw invalid("cursor applies only when resource is given.");
    const output = { skills: [await getSkill(root, name, full === true)] };
    if (full === true && JSON.stringify(output).length > RESULT_LIMIT) {
      throw workspaceError(
        "workspace-result-too-large",
        "Read the skill without full, then read each resource with name and resource. Long resources are paged; repeat with the returned cursor to continue.",
      );
    }
    return { output, repo: null };
  },
};
