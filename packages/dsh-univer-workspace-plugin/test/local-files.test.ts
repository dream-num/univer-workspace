import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { browseLocalFiles, resolveLocalFile } from "../src/webServer/local-files.ts";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function root() {
  const path = await mkdtemp(join(tmpdir(), "uwh-local-ref-"));
  roots.push(path);
  return path;
}
describe("host file references", () => {
  it("browses one level, completes a prefix, and resolves original host paths", async () => {
    const path = await root();
    await mkdir(join(path, "nested"));
    await writeFile(join(path, "budget report.csv"), "a,b");
    await writeFile(join(path, "nested", "child.txt"), "nested");
    await symlink(join(path, "budget report.csv"), join(path, "alias.csv"));
    const signal = new AbortController().signal;
    const page = await browseLocalFiles(path, signal);
    expect(page.entries.map((e) => e.name)).toEqual(["nested", "alias.csv", "budget report.csv"]);
    expect(page.entries.find((e) => e.name === "alias.csv")?.path).toBe(
      join(path, "budget report.csv"),
    );
    expect((await browseLocalFiles(join(path, "bud"), signal)).entries).toEqual([
      { kind: "file", name: "budget report.csv", path: join(path, "budget report.csv") },
    ]);
    expect(await resolveLocalFile(join(path, "nested"))).toEqual({
      kind: "folder",
      name: "nested",
      path: join(path, "nested"),
    });
    await expect(resolveLocalFile("relative/file")).rejects.toThrow("absolute");
    await expect(resolveLocalFile(join(path, "gone"))).rejects.toThrow();
  });
  it("caps directory results and cancels discovery", async () => {
    const path = await root();
    await Promise.all(
      Array.from({ length: 205 }, (_, i) => writeFile(join(path, `item-${i}`), "")),
    );
    const result = await browseLocalFiles(path, new AbortController().signal);
    expect(result.entries).toHaveLength(200);
    expect(result.truncated).toBe(true);
    const controller = new AbortController();
    controller.abort();
    await expect(browseLocalFiles(path, controller.signal)).rejects.toThrow();
  });
});
