import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { prepareContentExecutionProgram } from "@univer-cli/content-execution";
import { readFile, readdir } from "node:fs/promises";
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
  it("registers the eight Workspace candidates with static assets", async () => {
    const ctx = new Context();
    new SkillRegistry(ctx);
    apply(ctx);

    const listed = await ctx.skills.list();
    expect(listed.map((skill) => skill.name)).toEqual(EXPECTED_SKILLS);
    for (const candidate of listed) {
      const source = await readFile(
        new URL(`../skills/${candidate.name}/SKILL.md`, import.meta.url),
        "utf8",
      );
      expect(source).toMatch(new RegExp(`^name: ${candidate.name}$`, "m"));
      expect(source.split("\n").find((line) => line.startsWith("description: "))).toBe(
        `description: ${candidate.description}`,
      );
      expect(source.startsWith("---\n")).toBe(true);
    }
  });

  it("ships every linked Board reference beside its entrypoint", async () => {
    const board = await readSkill("univer-board");
    const root = fileURLToPath(new URL("../skills/univer-board", import.meta.url));
    const files = new Map<string, string>();
    async function visit(content: string, directory: string): Promise<void> {
      for (const match of content.matchAll(/\]\(([^)]+\.md)\)/g)) {
        if (/^[a-z]+:/i.test(match[1]!)) continue;
        const path = resolve(directory, match[1]!);
        const name = relative(root, path);
        expect(name.startsWith("..")).toBe(false);
        if (files.has(name)) continue;
        const text = await readFile(path, "utf8");
        files.set(name, text);
        await visit(text, dirname(path));
      }
    }
    await visit(board, root);
    expect([...files.keys()].sort()).toEqual(
      (await readdir(join(root, "references"))).map((name) => `references/${name}`).sort(),
    );
    expect(files.size).toBe(10);
  });

  it("accepts Base skill examples with the installed execution prelude", async () => {
    const base = await readSkill("univer-base");
    const examples = [...base.matchAll(/```js\n([\s\S]*?)```/g)];
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(() =>
        prepareContentExecutionProgram({
          code: example[1]!,
          unitId: "base-example",
          unitType: "base",
        }),
      ).not.toThrow();
    }
  });

  it("keeps the Workspace workflow contract intact", async () => {
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
