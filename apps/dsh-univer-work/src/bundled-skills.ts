import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import "@deepseek-ai/dsh-skill";

export const BUNDLED_WORKSPACE_SKILL_NAMES = [
  "base",
  "board",
  "cross-unit-formula",
  "doc",
  "embed",
  "sheet",
  "slide",
] as const;

export interface BundledWorkspaceSkillSource {
  readonly expectedName: string;
  readonly source: string;
}

export interface BundledWorkspaceSkill {
  readonly name: string;
  readonly description: string;
  readonly content: string;
}

export function loadBundledWorkspaceSkills(
  skillRoot: string = join(dirname(dirname(fileURLToPath(import.meta.url))), "skills"),
): readonly BundledWorkspaceSkill[] {
  const sources = BUNDLED_WORKSPACE_SKILL_NAMES.map((expectedName) => ({
    expectedName,
    source: readFileSync(join(skillRoot, expectedName, "SKILL.md"), "utf8"),
  }));
  if (sources.length !== BUNDLED_WORKSPACE_SKILL_NAMES.length) {
    throw new Error(`expected ${BUNDLED_WORKSPACE_SKILL_NAMES.length} bundled Workspace Skills`);
  }
  return sources.map(({ expectedName, source }, index) => {
    if (expectedName !== BUNDLED_WORKSPACE_SKILL_NAMES[index]) {
      throw new Error(`unexpected bundled Workspace Skill order at ${expectedName}`);
    }
    const match = source.match(/^---\r?\nname: ([^\r\n]+)\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n\r?\n([\s\S]+)$/u);
    if (match === null) throw new Error(`invalid bundled Workspace Skill definition: ${expectedName}`);
    const [, name = "", description = "", body = ""] = match;
    if (name !== expectedName) throw new Error(`bundled Workspace Skill name mismatch: ${expectedName}`);
    if (description.trim() === "" || body.trim() === "") {
      throw new Error(`empty bundled Workspace Skill definition: ${expectedName}`);
    }
    return { name, description, content: body.trim() };
  });
}

export function registerBundledWorkspaceSkills(
  ctx: Context,
  definitions: readonly BundledWorkspaceSkill[],
): () => void {
  const disposers: Array<() => void> = [];
  try {
    for (const definition of definitions) {
      disposers.push(ctx.skills.register({
        ...definition,
        source: "bundled",
        provider: "runtime",
      }));
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
