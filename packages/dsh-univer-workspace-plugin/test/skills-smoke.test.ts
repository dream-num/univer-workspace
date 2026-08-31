import { readFile } from "node:fs/promises";
import { Context } from "@deepseek-ai/cordis";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import { describe, expect, it } from "vitest";
import { apply } from "../src/skills/plugin.ts";

const EXPECTED_SKILLS = [
  "univer",
  "univer-base",
  "univer-board",
  "univer-cross-unit-formula",
  "univer-doc",
  "univer-embed",
  "univer-sheet",
  "univer-slide",
] as const;

describe("bundled Workspace Skills", () => {
  it("registers the eight Office-shaped candidates with static assets", async () => {
    const ctx = new Context();
    new SkillRegistry(ctx);
    apply(ctx);

    const listed = await ctx.skills.list();
    expect(listed.map(skill => skill.name)).toEqual(EXPECTED_SKILLS);
    for (const candidate of listed) {
      const source = await readFile(
        new URL(`../skills/${candidate.name}/SKILL.md`, import.meta.url),
        "utf8",
      );
      expect(source).toMatch(new RegExp(`^name: ${candidate.name}$`, "m"));
      expect(source).toMatch(new RegExp(`^description: ${escapeRegExp(candidate.description)}$`, "m"));
      expect(source.startsWith("---\n")).toBe(true);
    }
  });

  it("keeps the Office workflow contract intact", async () => {
    const core = await readSkill("univer");
    const sheet = await readSkill("univer-sheet");
    const doc = await readSkill("univer-doc");
    const slide = await readSkill("univer-slide");
    const base = await readSkill("univer-base");
    const board = await readSkill("univer-board");
    const embed = await readSkill("univer-embed");
    const crossUnitFormula = await readSkill("univer-cross-unit-formula");

    expect(core).toContain("univer_unit");
    expect(sheet).toContain("univer_execute");
    expect(doc).toContain("doc.getParagraphs()");
    expect(slide).toContain("univer_compile_svg");
    expect(slide).toContain("univer_screenshot");
    expect(base).toContain("getFormulaName()");
    expect(board).toContain("insertShape");
    expect(embed).toContain("createEmbed");
    expect(crossUnitFormula).toContain("buildReference()");
  });
});

async function readSkill(name: string): Promise<string> {
  return await readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");
}

function escapeRegExp(value: string): string {
  return value
    .replace(/[.*+?^$()|[\\]\\]/g, "\\$&")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}");
}
