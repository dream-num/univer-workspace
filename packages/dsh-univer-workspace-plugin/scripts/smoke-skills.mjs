/** Exercise the packed host's Skill loader/reader with published DSH host services. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { apply as applySkillTool } from "@deepseek-ai/dsh-tool-skill";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "workspace-packed-skills-"));
const previousCwd = process.cwd();
try {
  const [archive] = JSON.parse(
    run("npm", ["pack", "--json", `--pack-destination=${temporaryRoot}`], appRoot),
  );
  run("tar", ["-xzf", join(temporaryRoot, archive.filename), "-C", temporaryRoot], temporaryRoot);
  const packedRoot = join(temporaryRoot, "package");
  // These externals are supplied by a DSH host. Do not link workspace source or
  // the plugin itself: all Skill and resource reads must use the extracted tarball.
  const hostModules = join(temporaryRoot, "node_modules");
  await mkdir(hostModules);
  for (const dependency of ["@deepseek-ai", "zod", "ws"]) {
    await symlink(
      join(appRoot, "node_modules", dependency),
      join(hostModules, dependency),
      "junction",
    );
  }
  const sessionDirectory = join(temporaryRoot, "session");
  await mkdir(sessionDirectory);
  process.chdir(sessionDirectory);
  const host = await import(pathToFileURL(join(packedRoot, "lib/index.js")).href);
  let skillPlugin;
  host.apply(
    {
      plugin(plugin) {
        if (plugin.name === "univer-workspace-skills") skillPlugin = plugin;
      },
    },
    {
      workspaceRoot: sessionDirectory,
      license: "skill-smoke",
      workspaceOrigin: "https://workspace.test",
      publicOrigin: "http://127.0.0.1",
      templates: [],
    },
  );
  assert.ok(skillPlugin, "Packed host must mount the Skills plugin");
  const ctx = new Context();
  new SystemPrompt(ctx, {});
  new ToolRuntime(ctx);
  new SkillRegistry(ctx);
  applySkillTool(ctx);
  skillPlugin.apply(ctx);
  const executed = [];
  ctx.on("tools/pre-execute", async (exec, next) => {
    executed.push(exec.name);
    return next();
  });
  let callId = 0;
  async function invoke(name, args) {
    const result = await ctx.tools.execute({
      callId: ToolCallId(`packed-skill-${++callId}`),
      name,
      arguments: args,
      signal: new AbortController().signal,
    });
    assert.equal(result.isError, false, JSON.stringify(result));
    const rendered = JSON.stringify(result.content);
    assert.ok(
      !rendered.includes(packedRoot),
      "Model content must not advertise installation paths",
    );
    assert.ok(!rendered.includes(appRoot), "Model content must not depend on checkout paths");
    return result.value;
  }
  let resourceCount = 0;
  for (const skill of await ctx.skills.list()) {
    const loaded = await invoke("skill", { name: skill.name });
    assert.equal(loaded.resourceBase.kind, "opaque");
    for (const match of loaded.content.matchAll(/^- univer_skill_resource (.+)$/gm)) {
      const args = JSON.parse(match[1]);
      const actual = await invoke("univer_skill_resource", args);
      assert.deepEqual(actual, {
        ...args,
        content: await readFile(join(packedRoot, "skills", args.skill, args.path), "utf8"),
      });
      resourceCount += 1;
    }
  }
  assert.equal(resourceCount, 13, "Packed HTML View and Board references must all be available");
  assert.deepEqual(new Set(executed), new Set(["skill", "univer_skill_resource"]));
  const denied = await ctx.tools.execute({
    callId: ToolCallId("packed-skill-denied"),
    name: "univer_skill_resource",
    arguments: { skill: "univer-board", path: join(packedRoot, "README.md") },
    signal: new AbortController().signal,
  });
  assert.equal(denied.isError, true);
  assert.equal(denied.error.info.code, "SKILL_RESOURCE_NOT_FOUND");
  console.log(
    `[skills-package-smoke] packed host loaded all Skills and read ${resourceCount} references through native DSH tools`,
  );
} finally {
  process.chdir(previousCwd);
  await rm(temporaryRoot, { recursive: true, force: true });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout;
}
