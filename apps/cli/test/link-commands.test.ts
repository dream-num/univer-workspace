import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runUnlinkWorkspaceCli } from "../../../scripts/unlink-workspace-cli.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path) => {
      await rm(path, { force: true, recursive: true });
    }),
  );
});

describe("Workspace CLI global link commands", () => {
  it("exposes the production-aligned root commands", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { readonly scripts: Record<string, string> };

    expect(packageJson.scripts["link:workspace-cli"]).toBe(
      "pnpm --filter univer-workspace-cli build && pnpm link --global ./apps/cli",
    );
    expect(packageJson.scripts["unlink:workspace-cli"]).toBe(
      "node scripts/unlink-workspace-cli.mjs",
    );
  });

  it("does nothing when the CLI is not globally linked", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ dependencies: { "another-package": "link:../another-package" } }),
    );
    const log = vi.fn();
    const removeGlobalPackage = vi.fn(() => 0);

    expect(
      runUnlinkWorkspaceCli({
        console: { error: vi.fn(), log } as unknown as Console,
        pnpmRootGlobal: () => join(directory, "node_modules"),
        removeGlobalPackage,
      }),
    ).toBe(0);
    expect(removeGlobalPackage).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "univer-workspace-cli is not globally linked; nothing to unlink.",
    );
  });

  it("removes the globally linked CLI package", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        dependencies: {
          "univer-workspace-cli": "link:../../apps/cli",
        },
      }),
    );
    const removeGlobalPackage = vi.fn(() => 0);

    expect(
      runUnlinkWorkspaceCli({
        console: { error: vi.fn(), log: vi.fn() } as unknown as Console,
        pnpmRootGlobal: () => join(directory, "node_modules"),
        removeGlobalPackage,
      }),
    ).toBe(0);
    expect(removeGlobalPackage).toHaveBeenCalledOnce();
    expect(removeGlobalPackage).toHaveBeenCalledWith("univer-workspace-cli");
  });

});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "univer-workspace-cli-link-"));
  temporaryDirectories.push(directory);
  return directory;
}
