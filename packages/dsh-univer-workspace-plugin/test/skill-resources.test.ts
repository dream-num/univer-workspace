import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { apply as applySkillTool } from "@deepseek-ai/dsh-tool-skill";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import { afterEach, describe, expect, it } from "vitest";
import { registerBundledSkills } from "../src/skills/plugin.ts";
import { BundledSkillResources } from "../src/skills/resources.ts";

const root = new URL("../skills/", import.meta.url);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function setup() {
  const ctx = new Context();
  new SystemPrompt(ctx, {});
  new ToolRuntime(ctx);
  new SkillRegistry(ctx);
  applySkillTool(ctx);
  const dispose = registerBundledSkills(ctx, root);
  let id = 0;
  const run = (name: string, args: unknown) =>
    ctx.tools.execute({
      callId: ToolCallId(`skill-call-${++id}`),
      name,
      arguments: args,
      signal: new AbortController().signal,
    });
  return { ctx, run, dispose };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "workspace-skill-resources-"));
  directories.push(directory);
  const packageRoot = join(directory, "skills");
  const skillRoot = join(packageRoot, "univer-board");
  await mkdir(join(skillRoot, "references", "nested"), { recursive: true });
  await mkdir(join(skillRoot, "templates"));
  await writeFile(join(skillRoot, "SKILL.md"), "# Test skill");
  await writeFile(join(skillRoot, "references", "nested", "guide.md"), "nested guide");
  await writeFile(join(skillRoot, "templates", "board.json"), '{"nodes":[]}');
  return {
    directory,
    packageRoot,
    skillRoot,
    resources: new BundledSkillResources(pathToFileURL(packageRoot), ["univer-board"]),
  };
}

describe("bundled Skill resource reader", () => {
  it("uses the native DSH skill loader and tool pipeline without Shell or file tools", async () => {
    const { ctx, run, dispose } = setup();
    const executed: string[] = [];
    ctx.on("tools/pre-execute", async (exec, next) => {
      executed.push(exec.name);
      return next();
    });
    for (const [skill, count] of [
      ["univer-html-view", 3],
      ["univer-board", 10],
    ] as const) {
      const loaded = await run("skill", { name: skill });
      expect(loaded.isError).toBe(false);
      if (loaded.isError) throw new Error(loaded.error.message);
      const value = loaded.value as { content: string; resourceBase: { kind: string } };
      expect(value.resourceBase.kind).toBe("opaque");
      expect(JSON.stringify(loaded.content)).not.toContain(fileURLToPath(root));
      const calls = [...value.content.matchAll(/^- univer_skill_resource (.+)$/gm)].map(
        (match) => JSON.parse(match[1]!) as { skill: string; path: string },
      );
      expect(calls).toHaveLength(count);
      for (const args of calls) {
        const read = await run("univer_skill_resource", args);
        expect(read.isError).toBe(false);
        if (read.isError) throw new Error(read.error.message);
        expect(read.value).toEqual({
          ...args,
          content: await readFile(new URL(`${args.skill}/${args.path}`, root), "utf8"),
        });
        expect(JSON.stringify(read.content)).not.toContain(fileURLToPath(root));
      }
    }
    expect(new Set(executed)).toEqual(new Set(["skill", "univer_skill_resource"]));
    dispose();
    expect(ctx.tools.get("univer_skill_resource")).toBeUndefined();
    expect(await ctx.skills.get("univer-board")).toBeUndefined();
  });

  it("lists and reads nested references and templates, without a session or login", async () => {
    const { resources } = await fixture();
    expect(await resources.list("univer-board")).toEqual([
      "references/nested/guide.md",
      "templates/board.json",
    ]);
    expect(await resources.read("univer-board", "templates/board.json")).toEqual({
      skill: "univer-board",
      path: "templates/board.json",
      content: '{"nodes":[]}',
    });
  });

  it("rejects unknown Skills, unlisted files, absolute paths and traversal through the native tool", async () => {
    const { run } = setup();
    for (const path of [
      "SKILL.md",
      "references/missing.md",
      "../univer/SKILL.md",
      "references/../../univer/SKILL.md",
      fileURLToPath(new URL("univer/SKILL.md", root)),
      "C:\\private\\secret.txt",
    ]) {
      const result = await run("univer_skill_resource", { skill: "univer-board", path });
      expect(result).toMatchObject({
        isError: true,
        error: { info: { code: "SKILL_RESOURCE_NOT_FOUND" } },
      });
      expect(JSON.stringify(result.content)).not.toContain(fileURLToPath(root));
    }
    expect(
      await run("univer_skill_resource", { skill: "../univer", path: "references/test.md" }),
    ).toMatchObject({ isError: true, error: { info: { code: "SKILL_NOT_FOUND" } } });
  });

  it("does not expose symlinked files, folders, or Skill directories outside the bundle", async () => {
    const { resources, directory, skillRoot, packageRoot } = await fixture();
    const outside = join(directory, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "private.md"), "private content");
    await symlink(join(outside, "private.md"), join(skillRoot, "references", "escape.md"));
    await symlink(outside, join(skillRoot, "references", "escape-directory"));
    expect(await resources.list("univer-board")).toEqual([
      "references/nested/guide.md",
      "templates/board.json",
    ]);
    for (const path of ["references/escape.md", "references/escape-directory/private.md"]) {
      await expect(resources.read("univer-board", path)).rejects.toMatchObject({
        code: "SKILL_RESOURCE_NOT_FOUND",
      });
    }
    await rm(join(skillRoot, "references"), { recursive: true });
    await symlink(outside, join(skillRoot, "references"));
    await expect(resources.read("univer-board", "references/private.md")).rejects.toMatchObject({
      code: "SKILL_RESOURCE_NOT_FOUND",
    });
    await rm(skillRoot, { recursive: true });
    await symlink(outside, join(packageRoot, "univer-board"));
    await expect(resources.list("univer-board")).rejects.toMatchObject({
      code: "SKILL_RESOURCE_UNAVAILABLE",
    });
  });

  it("honors cancellation and reports missing packaged content without leaking local paths", async () => {
    const { resources, skillRoot, directory } = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      resources.read("univer-board", "templates/board.json", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    await rm(join(skillRoot, "SKILL.md"));
    await expect(resources.entry("univer-board")).rejects.toMatchObject({
      code: "SKILL_RESOURCE_UNAVAILABLE",
    });
    await resources
      .entry("univer-board")
      .catch((error: Error) => expect(error.message).not.toContain(directory));
  });
});
