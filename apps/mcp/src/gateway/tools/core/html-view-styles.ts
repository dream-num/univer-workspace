import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";

const localizedText = z.object({ en: z.string().min(1), zh: z.string().min(1) });
export const htmlViewStylesSchema = z.object({
  default: z.string().min(1),
  styles: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
        name: localizedText,
        mood: localizedText,
      }),
    )
    .min(1),
});

export function parseHtmlViewStyles(design: string) {
  const catalog = design.split(/^## Style catalog\s*$/mu)[1]?.split(/^## /mu)[0];
  if (!catalog) throw new Error("Missing HTML View Style catalog");
  const defaults: string[] = [];
  const styles = catalog
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("| ["))
    .map((line) => {
      const [template, en = "", zh = "", moodEn, moodZh] = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      const id = /^\[([a-z0-9-]+)\]\(\.\.\/templates\/\1\.univer\.html\)$/u.exec(
        template ?? "",
      )?.[1];
      const englishDefault = en.endsWith("(default)");
      const chineseDefault = zh.endsWith("（默认）");
      if (englishDefault !== chineseDefault) throw new Error("HTML View default markers disagree");
      if (englishDefault && id) defaults.push(id);
      return {
        id,
        name: { en: en.replace(/\s*\(default\)$/u, ""), zh: zh.replace(/\s*（默认）$/u, "") },
        mood: { en: moodEn, zh: moodZh },
      };
    });
  if (defaults.length !== 1) throw new Error("HTML View catalog must have exactly one default");
  const output = htmlViewStylesSchema.parse({ default: defaults[0], styles });
  if (new Set(output.styles.map(({ id }) => id)).size !== output.styles.length) {
    throw new Error("Duplicate HTML View style ID");
  }
  return output;
}

export const htmlViewStylesTool: ToolDefinition = {
  name: "html_view_styles",
  toolset: "core",
  scope: "read",
  title: "List HTML View styles",
  description:
    "Return the built-in HTML View style catalog for showing a style gallery. Workspace renders the result as clickable cards. You must still list every style name and mood in your reply text in the user's language, because other clients show no gallery.",
  inputSchema: z.object({}),
  outputSchema: htmlViewStylesSchema,
  annotations: readOnlyAnnotations,
  async run(context) {
    if (!context.skills) throw new Error("Missing Skill catalog");
    const skills = await context.skills;
    return {
      output: parseHtmlViewStyles(skills.read("html-view", "references/design.md")),
      repo: null,
    };
  },
};
