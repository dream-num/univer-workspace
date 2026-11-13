import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { discoverSkills, customSkillFiles } from "../../custom-skills.js";
import { repoInput } from "./issue-support.js";
import { pageText, RESULT_LIMIT } from "../../paging.js";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";

const inputSchema = z.object({
  repo: repoInput.optional(),
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
    "Read built-in and custom operational Skills that teach the Workspace workflow. Without name it lists the skills, including live personal .agents/skills and member repository skills when repo is given. With name it returns {name, source, content, resources?, binaryFiles?} directly (with full: true also files containing its references and templates). With name and resource it returns one reference or template. A long resource has truncated: true and a cursor; call again with the same arguments and that cursor to continue.",
  inputSchema,
  outputSchema: z.object({
    skills: z
      .array(
        z.object({
          name: z.string(),
          description: z.string(),
          source: z.enum(["builtin", "repository", "user"]),
          path: z.string().optional(),
          modelInvocable: z.boolean(),
          userInvocable: z.boolean(),
          argumentHint: z.string().optional(),
        }),
      )
      .optional(),
    diagnostics: z.array(z.object({
      source: z.enum(["repository", "user"]), path: z.string(),
      problem: z.enum(["invalid-skill", "reserved-name", "shadowed", "too-large"]),
      detail: z.string().optional(),
    })).optional(),
    repository: z.enum(["loaded", "not-member", "no-repository"]).optional(),
    source: z.enum(["builtin", "repository", "user"]).optional(),
    binaryFiles: z.array(z.object({ path: z.string(), byteSize: z.number(), mediaType: z.string() })).optional(),
    name: z.string().optional(),
    resources: z.array(z.object({ path: z.string(), readCommand: z.string() })).optional(),
    files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
    path: z.string().optional(),
    content: z.string().optional(),
    truncated: z.boolean().optional(),
    cursor: z.string().optional(),
  }),
  annotations: readOnlyAnnotations,
  async run(context, args) {
    const { repo, name, resource, full, cursor } = inputSchema.parse(args);
    if (!context.skills) throw new Error("Missing Skill catalog");
    const builtin = await context.skills;
    if (name === undefined) {
      if (resource !== undefined || full !== undefined || cursor !== undefined) {
        throw invalid("resource, full and cursor need a skill name.");
      }
    }
    if (resource !== undefined && full !== undefined) throw invalid("full applies only when resource is omitted.");
    if (resource === undefined && cursor !== undefined) throw invalid("cursor applies only when resource is given.");
    const discovery = await discoverSkills(context, builtin, repo, name);
    if (name === undefined) {
      return {
        output: { skills: [...discovery.skills.values()], diagnostics: discovery.diagnostics, repository: discovery.repository },
        repo: discovery.repo,
      };
    }
    const entry = discovery.skills.get(name);
    if (!entry)
      throw invalid(
        `Unknown skill: ${name}. Call skills_read without arguments to list the skills.`,
      );
    let paths: string[];
    let read: (name: string, path: string) => string;
    let binaryFiles: { path: string; byteSize: number; mediaType: string }[] = [];
    if (discovery.custom) {
      const custom = await customSkillFiles(context, discovery.custom);
      paths = [...custom.files.keys()];
      read = (_name, path) => custom.files.get(path)!;
      binaryFiles = custom.binaryFiles;
    } else {
      const staticEntry = builtin.catalog.entries.find((skill) => skill.frontmatter.name === name)!;
      if (!Array.isArray(staticEntry.resources)) throw new Error("Static Skill resources are required");
      paths = staticEntry.resources.map(({ uri }) => uri.slice(staticEntry.uri.lastIndexOf("/") + 1));
      read = builtin.read;
    }
    if (resource !== undefined) {
      if (!paths.includes(resource))
        throw invalid(
          `Unknown resource for skill ${name}: ${resource}. Call skills_read with name "${name}" to list resources.`,
        );
      return {
        output: pageText(
          "skills_read",
          { repo, name, resource },
          cursor,
          read(name, resource),
          (content) => ({ name, source: entry.source, path: resource, content }),
        ),
        repo: discovery.repo,
      };
    }
    const supplemental = paths.filter((path) => path !== "SKILL.md");
    const output = {
      name,
      source: entry.source,
      ...(binaryFiles.length ? { binaryFiles } : {}),
      content: read(name, "SKILL.md"),
      ...(supplemental.length
        ? {
            resources: supplemental.map((path) => ({
              path,
              readCommand: `Call skills_read with name "${name}" and resource "${path}"${repo === undefined ? "" : ` and repo ${JSON.stringify(repo)}`}.`,
            })),
          }
        : {}),
      ...(full === true
        ? { files: supplemental.map((path) => ({ path, content: read(name, path) })) }
        : {}),
    };
    if (full === true && JSON.stringify(output).length > RESULT_LIMIT) {
      throw workspaceError(
        "workspace-result-too-large",
        "Read the skill without full, then read each resource with name and resource. Long resources are paged; repeat with the returned cursor to continue.",
      );
    }
    return { output, repo: discovery.repo };
  },
};
