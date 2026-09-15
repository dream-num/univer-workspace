import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { registerUniverTool, renderJson } from "../tools/presentation.ts";
import type { BundledSkillResources } from "./resources.ts";

export function registerSkillResourceTool(
  ctx: Context,
  resources: BundledSkillResources,
): () => void {
  return registerUniverTool(
    ctx,
    defineTool({
      name: "univer_skill_resource",
      description:
        "Read one reference or template bundled with a Workspace Skill. First load the Skill with the skill tool to see its resource paths and call examples. Pass the exact Skill name and listed relative resource path. This reads packaged documentation, independent of the session directory and Workspace login; it cannot read arbitrary local files.",
      parameters: {
        skill: {
          type: "string",
          required: true,
          description: "Exact bundled Skill name, e.g. univer-html-view or univer-board.",
        },
        path: {
          type: "string",
          required: true,
          description:
            "Exact listed resource path, e.g. references/charts.md. Absolute paths and traversal are not accepted.",
        },
      },
      output: { schema: { type: "json" }, render: renderJson },
      async execute(args, exec) {
        return resources.read(args.skill, args.path, exec.signal);
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Skill reference: ${args.skill} / ${args.path}`,
        kind: "read",
      }),
    }),
    "SKILL_RESOURCE_UNAVAILABLE",
  );
}
