import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { pageText, RESULT_LIMIT } from "../../paging.js";
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
    if (!context.skills) throw new Error("Missing Skill catalog");
    const { catalog, read } = await context.skills;
    if (name === undefined) {
      if (resource !== undefined || full !== undefined || cursor !== undefined) {
        throw invalid("resource, full and cursor need a skill name.");
      }
      return {
        output: {
          skills: catalog.entries.map(({ frontmatter: { name, description } }) => ({
            name,
            description,
          })),
        },
        repo: null,
      };
    }
    const entry = catalog.entries.find((skill) => skill.frontmatter.name === name);
    if (!entry)
      throw invalid(
        `Unknown skill: ${name}. Call skills_read without arguments to list the skills.`,
      );
    if (!Array.isArray(entry.resources)) throw new Error("Static Skill resources are required");
    const paths = entry.resources.map(({ uri }) => uri.slice(entry.uri.lastIndexOf("/") + 1));
    if (resource !== undefined) {
      if (full !== undefined) throw invalid("full applies only when resource is omitted.");
      if (!paths.includes(resource))
        throw invalid(
          `Unknown resource for skill ${name}: ${resource}. Call skills_read with name "${name}" to list resources.`,
        );
      return {
        output: pageText(
          "skills_read",
          { name, resource },
          cursor,
          read(name, resource),
          (content) => ({ name, path: resource, content }),
        ),
        repo: null,
      };
    }
    if (cursor !== undefined) throw invalid("cursor applies only when resource is given.");
    const supplemental = paths.filter((path) => path !== "SKILL.md");
    const output = {
      skills: [
        {
          name,
          content: read(name, "SKILL.md"),
          ...(supplemental.length
            ? {
                resources: supplemental.map((path) => ({
                  path,
                  readCommand: `Call skills_read with name "${name}" and resource "${path}".`,
                })),
              }
            : {}),
          ...(full === true
            ? { files: supplemental.map((path) => ({ path, content: read(name, path) })) }
            : {}),
        },
      ],
    };
    if (full === true && JSON.stringify(output).length > RESULT_LIMIT) {
      throw workspaceError(
        "workspace-result-too-large",
        "Read the skill without full, then read each resource with name and resource. Long resources are paged; repeat with the returned cursor to continue.",
      );
    }
    return { output, repo: null };
  },
};
