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
      expect(source).not.toContain("univer_screenshot");
      expect(source).not.toContain("univer_lint");
      expect(source).not.toContain("univer_compile_svg");
    }
  });

  it("keeps the verified-type boundary explicit", async () => {
    const core = await readSkill("univer");
    const sheet = await readSkill("univer-sheet");
    expect(core).toContain("Facade read workflow for all five types");
    expect(core).toContain("verified Sheet writes");
    expect(core).toContain("Doc, Slide, Base, and Board");
    expect(core).toContain("beta-limited");
    expect(sheet).toContain("unitType: \"sheet\"");
    expect(sheet).toContain("univer_execute");

    for (const name of ["univer-doc", "univer-slide", "univer-base", "univer-board"] as const) {
      const content = await readSkill(name);
      expect(content).toContain("beta-limited");
      expect(content).toContain("univer_status");
      expect(content).toContain("do not report");
    }
    expect(await readSkill("univer-embed")).toContain("no verified embed");
    expect(await readSkill("univer-cross-unit-formula")).toContain("no verified cross-Unit");
  });
});

async function readSkill(name: string): Promise<string> {
  return await readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
