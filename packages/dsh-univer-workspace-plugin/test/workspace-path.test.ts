import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { afterEach, describe, expect, it } from "vitest";
import { resolveExecutionCode } from "../src/tools/edit.js";
import { existingSessionPath, newSessionPath } from "../src/tools/workspace-path.js";

const temporaryRoots: string[] = [];

function execution(cwd: string): ToolRunContext {
  return { agent: { session: { header: { cwd } } } } as unknown as ToolRunContext;
}

async function fixture(): Promise<{ root: string; workspace: string; outside: string }> {
  const root = await mkdtemp(join(tmpdir(), "uwh-path-"));
  temporaryRoots.push(root);
  const workspace = join(root, "workspace");
  const outside = join(root, "outside");
  await mkdir(workspace);
  await mkdir(outside);
  return { root, workspace, outside };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("session workspace paths", () => {
  it("resolves existing inputs and new outputs inside the canonical workspace", async () => {
    const { workspace } = await fixture();
    await writeFile(join(workspace, "program.js"), "return 42;", "utf8");
    await expect(existingSessionPath(execution(workspace), "program.js")).resolves.toMatchObject({
      workspace,
      path: join(workspace, "program.js"),
    });
    await expect(newSessionPath(execution(workspace), "output/result.xlsx")).resolves.toMatchObject({
      workspace,
      path: join(workspace, "output/result.xlsx"),
    });
  });

  it("rejects lexical traversal and symlink escapes for both reads and writes", async () => {
    const { root, workspace, outside } = await fixture();
    await writeFile(join(outside, "secret.js"), "secret", "utf8");
    await symlink(outside, join(workspace, "escape"), "dir");
    await expect(existingSessionPath(execution(workspace), join(root, "outside/secret.js"))).rejects.toThrow(/inside the session workspace/);
    await expect(existingSessionPath(execution(workspace), "escape/secret.js")).rejects.toThrow(/inside the session workspace/);
    await expect(newSessionPath(execution(workspace), "escape/new.js")).rejects.toThrow(/inside the session workspace/);
  });

  it("loads exactly one execution source and applies the same path boundary to codeFile", async () => {
    const { workspace, outside } = await fixture();
    await writeFile(join(workspace, "program.js"), "return univerAPI.getActiveWorkbook();", "utf8");
    await writeFile(join(outside, "secret.js"), "secret", "utf8");
    const exec = execution(workspace);
    await expect(resolveExecutionCode(exec, "return 1;", undefined)).resolves.toBe("return 1;");
    await expect(resolveExecutionCode(exec, undefined, "program.js")).resolves.toBe("return univerAPI.getActiveWorkbook();");
    await expect(resolveExecutionCode(exec, undefined, undefined)).rejects.toThrow(/exactly one/);
    await expect(resolveExecutionCode(exec, "return 1;", "program.js")).rejects.toThrow(/exactly one/);
    await expect(resolveExecutionCode(exec, undefined, join(outside, "secret.js"))).rejects.toThrow(/inside the session workspace/);
  });
});
