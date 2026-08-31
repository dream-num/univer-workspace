import { copyFile, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import { describe, expect, it, vi } from "vitest";
import {
  ACCEPTED_WORKSPACE_TOOL_NAMES,
  BUNDLED_SKILL_NAMES,
  validateBundledSkillSources,
} from "../scripts/skill-contract.mjs";
import {
  BUNDLED_WORKSPACE_SKILL_NAMES,
  loadBundledWorkspaceSkills,
  registerBundledWorkspaceSkills,
  type BundledWorkspaceSkillSource,
} from "../src/bundled-skills.js";

const skillRoot = fileURLToPath(new URL("../skills", import.meta.url));

describe("DSH-native Unit Skill sources", () => {
  it("owns the seven exact additions without another core Skill", async () => {
    const names = (await readdir(skillRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(names).toEqual(["base", "board", "core", "cross-unit-formula", "doc", "embed", "sheet", "slide"]);
    expect(BUNDLED_SKILL_NAMES).toEqual(["base", "board", "cross-unit-formula", "doc", "embed", "sheet", "slide"]);
  });

  it("satisfies the source and future packed-copy contracts", async () => {
    const packedRoot = await mkdtemp(join(tmpdir(), "dsh-unit-skills-"));
    try {
      const sourceDefinitions = await rawSources();
      validateBundledSkillSources(contractSources(sourceDefinitions), ACCEPTED_WORKSPACE_TOOL_NAMES);
      for (const { expectedName, source } of sourceDefinitions) {
        const packed = join(packedRoot, "skills", expectedName, "SKILL.md");
        await mkdir(join(packedRoot, "skills", expectedName), { recursive: true });
        await copyFile(join(skillRoot, expectedName, "SKILL.md"), packed);
        expect(await readFile(packed, "utf8")).toBe(source);
      }
      validateBundledSkillSources(await readDefinitions(join(packedRoot, "skills")), ACCEPTED_WORKSPACE_TOOL_NAMES);
    } finally {
      await rm(packedRoot, { recursive: true, force: true });
    }
  });

  it("rejects missing, forbidden, unknown, renamed, stale-owner, CLI, and absolute-path drift", async () => {
    const sources = await rawSources();
    const cases: Array<readonly [string, string, string, RegExp]> = [
      ["base", "workspace_screenshot", "", /missing required operation workspace_screenshot/u],
      ["board", "Board has no supported Office exchange.", "workspace_office_import", /forbidden operation workspace_office_import/u],
      ["doc", "workspace_content_execute", "workspace_content_run", /missing required operation workspace_content_execute/u],
      ["sheet", "workspace_content_execute", "workspace_content_execute workspace_future_tool", /unknown operation workspace_future_tool/u],
      ["board", "FBoard.newChart", "FWorkbook.newChart", /missing semantic anchor FBoard\.newChart/u],
      ["base", 'const unitId = "<selected-unit-id>";\nconst base = api.getBase(unitId);', 'const base = api.getBase(unitId);\nconst unitId = "<selected-unit-id>";', /semantic order const unitId/u],
      ["sheet", "const sheet = workbook.getActiveSheet();\nconst calculated", "const calculated", /missing semantic anchor workbook\.getActiveSheet/u],
      ["slide", "Load `core` first.", "Load `core` with skills get.", /prohibited CLI/u],
      ["doc", "Load `core` first.", "Load `core` first with `-f code`.", /prohibited CLI/u],
      ["board", "Load `core` first.", "Load `core` first with `--json`.", /prohibited CLI/u],
      ["base", "Load `core` first.", "Load `core` first with `--worktree=id`.", /prohibited CLI/u],
      ["embed", "Load `core` plus", "Read /home/me/repo/SKILL.md before loading `core` plus", /prohibited CLI/u],
      ["cross-unit-formula", "Load `core`,", "Read D:\\repo\\SKILL.md, then load `core`,", /prohibited CLI/u],
      ["sheet", "Load `core` first.", "Read D:/repo/SKILL.md, then load `core` first.", /prohibited CLI/u],
      ["embed", "Load `core`", "Use univer-workspace-cli then load `core`", /prohibited CLI/u],
      ["cross-unit-formula", "Load `core`", "Read /Users/example/skill then load `core`", /prohibited CLI/u],
    ];
    for (const [name, from, to, failure] of cases) {
      const changed = sources.map((entry) => entry.expectedName === name
        ? { ...entry, source: entry.source.replace(from, to) }
        : entry);
      expect(() => validateBundledSkillSources(contractSources(changed), ACCEPTED_WORKSPACE_TOOL_NAMES), name).toThrow(failure);
    }
  });
});

describe("bundled Workspace Skill registration", () => {
  it("validates every definition before touching the real registry", async () => {
    const ctx = await registryContext();
    const root = await mkdtemp(join(tmpdir(), "dsh-invalid-unit-skills-"));
    try {
      const sources = await rawSources();
      sources[3] = { ...sources[3]!, source: sources[3]!.source.replace("name: doc", "name: wrong") };
      for (const { expectedName, source } of sources) {
        await mkdir(join(root, expectedName), { recursive: true });
        await writeFile(join(root, expectedName, "SKILL.md"), source);
      }
      const register = vi.spyOn(ctx.skills, "register");
      expect(() => registerBundledWorkspaceSkills(
        ctx,
        loadBundledWorkspaceSkills(root),
      )).toThrow(/name mismatch/u);
      expect(register).not.toHaveBeenCalled();
      expect(await ctx.skills.list()).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await ctx.fiber.dispose();
    }
  });

  it("uses normalized native defaults and disposes exact registrations in reverse", async () => {
    const ctx = await registryContext();
    try {
      const disposed: string[] = [];
      const nativeRegister = ctx.skills.register.bind(ctx.skills);
      vi.spyOn(ctx.skills, "register").mockImplementation((skill) => {
        const dispose = nativeRegister(skill);
        return () => {
          disposed.push(skill.name);
          dispose();
        };
      });
      const definitions = loadBundledWorkspaceSkills();
      const dispose = registerBundledWorkspaceSkills(ctx, definitions);
      expect((await ctx.skills.list()).map(({ name }) => name)).toEqual([...BUNDLED_WORKSPACE_SKILL_NAMES]);
      for (const definition of definitions) {
        await expect(ctx.skills.get(definition.name)).resolves.toMatchObject({
          ...definition,
          source: "bundled",
          provider: "runtime",
          invocation: { modelInvocable: true, userInvocable: true },
        });
      }
      dispose();
      expect(disposed).toEqual([...BUNDLED_WORKSPACE_SKILL_NAMES].reverse());
      expect(await ctx.skills.list()).toEqual([]);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it("keeps the native first winner and rolls back an unexpected partial registration", async () => {
    const ctx = await registryContext();
    try {
      const disposeWinner = ctx.skills.register({ name: "base", description: "Earlier winner", content: "winner body", source: "bundled", provider: "runtime" });
      const definitions = loadBundledWorkspaceSkills();
      const disposeBundled = registerBundledWorkspaceSkills(ctx, definitions);
      await expect(ctx.skills.get("base")).resolves.toMatchObject({ content: "winner body" });
      disposeBundled();
      await expect(ctx.skills.get("base")).resolves.toMatchObject({ content: "winner body" });
      disposeWinner();

      const nativeRegister = ctx.skills.register.bind(ctx.skills);
      const disposed: string[] = [];
      let count = 0;
      vi.spyOn(ctx.skills, "register").mockImplementation((skill) => {
        count += 1;
        if (count === 3) throw new Error("registration failed");
        const dispose = nativeRegister(skill);
        return () => {
          disposed.push(skill.name);
          dispose();
        };
      });
      expect(() => registerBundledWorkspaceSkills(ctx, definitions)).toThrow("registration failed");
      expect(disposed).toEqual(["board", "base"]);
      expect(await ctx.skills.list()).toEqual([]);
    } finally {
      await ctx.fiber.dispose();
    }
  });
});

async function registryContext(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(SkillRegistry);
  return ctx;
}

async function rawSources(): Promise<BundledWorkspaceSkillSource[]> {
  return await Promise.all(BUNDLED_WORKSPACE_SKILL_NAMES.map(async (expectedName) => ({
    expectedName,
    source: await readFile(join(skillRoot, expectedName, "SKILL.md"), "utf8"),
  })));
}

async function readDefinitions(root: string): Promise<Array<{ readonly name: string; readonly source: string }>> {
  return await Promise.all(BUNDLED_WORKSPACE_SKILL_NAMES.map(async (name) => ({
    name,
    source: await readFile(join(root, name, "SKILL.md"), "utf8"),
  })));
}

function contractSources(sources: readonly BundledWorkspaceSkillSource[]): Array<{ readonly name: string; readonly source: string }> {
  return sources.map(({ expectedName: name, source }) => ({ name, source }));
}
