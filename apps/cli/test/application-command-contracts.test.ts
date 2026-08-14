import { Command, type OutputConfiguration } from "commander";
import { describe, expect, it, vi } from "vitest";
import { createAssetCommand } from "../src/features/asset/command.js";
import type { WorkspaceAssetFeature } from "../src/features/asset/download.js";
import { createBlobCommand } from "../src/features/blob/command.js";
import type { WorkspaceBlobFeature } from "../src/features/blob/transfer.js";
import { createContentExecuteCommand } from "../src/features/content/command.js";
import type { WorkspaceContentExecutionFeature } from "../src/features/content/execution.js";
import { createOpenCommand } from "../src/features/open/command.js";
import type { WorkspaceOpenFeature } from "../src/features/open/open.js";
import { createSpaceCommand } from "../src/features/space/command.js";
import type { WorkspaceSpaceFeature } from "../src/features/space/space.js";
import { createUnitCommand } from "../src/features/unit/command.js";
import type { WorkspaceUnitFeature } from "../src/features/unit/membership.js";
import { createWorktreeCommand } from "../src/features/worktree/command.js";
import type { WorkspaceWorktreeFeature } from "../src/features/worktree/management.js";

describe("Workspace application Commander adapters", () => {
  it("maps every execute code source and preserves the production result envelope", async () => {
    const execute = vi.fn(async () => ({
      committed: true,
      revision: 8,
      status: "committed",
      value: { ok: true },
    }));
    const command = createContentExecuteCommand(
      { execute } as unknown as WorkspaceContentExecutionFeature,
      { readScript: async (path) => `// ${path}\nreturn 2;` },
    );

    const inline = await run(command, [
      "--worktree",
      "wt-1",
      "--unit",
      "sheet-1",
      "-e",
      "return 1;",
      "--json",
    ]);
    await run(command, ["--worktree", "wt-1", "--unit", "sheet-1", "--script", "edit.js"]);

    expect(execute).toHaveBeenNthCalledWith(1, {
      code: "return 1;",
      unitId: "sheet-1",
      worktreeId: "wt-1",
    });
    expect(execute).toHaveBeenNthCalledWith(2, {
      code: "// edit.js\nreturn 2;",
      unitId: "sheet-1",
      worktreeId: "wt-1",
    });
    expect(JSON.parse(inline)).toEqual({
      committed: true,
      revision: 8,
      status: "committed",
      value: { ok: true },
    });
  });

  it("rejects missing or multiple execute code sources before entering the runtime", async () => {
    const execute = vi.fn();
    const command = createContentExecuteCommand({
      execute,
    } as unknown as WorkspaceContentExecutionFeature);
    const scope = ["--worktree", "wt-1", "--unit", "sheet-1"];

    await expect(run(command, scope)).rejects.toThrow(/process\.exit/u);
    await expect(
      run(command, [...scope, "-e", "return 1;", "--code", "return 2;"]),
    ).rejects.toThrow(/process\.exit/u);
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps Space browse/find and Node management arguments without dropping intent", async () => {
    const browse = vi.fn(async () => []);
    const find = vi.fn(async () => []);
    const createNode = vi.fn(async () => ({ nodeId: "node-1" }));
    const moveNode = vi.fn(async () => ({ nodeId: "node-1" }));
    const renameNode = vi.fn(async () => ({ nodeId: "node-1" }));
    const trashNode = vi.fn(async () => ({ trashBatchId: "trash-1" }));
    const command = createSpaceCommand({
      browse,
      createNode,
      find,
      list: async () => [],
      moveNode,
      renameNode,
      trashNode,
    } as unknown as WorkspaceSpaceFeature);

    await run(command, [
      "browse",
      "space-1",
      "--parent",
      "parent-1",
      "--recursive",
      "--resource-kind",
      "univer",
      "--unit-type",
      "sheet",
      "--json",
    ]);
    await run(command, [
      "find",
      "quarterly",
      "plan",
      "--space",
      "space-1",
      "--resource-kind",
      "blob",
    ]);
    await run(command, ["node", "create", "space-1", "--name", "Folder", "--parent", "parent-1"]);
    await run(command, ["node", "rename", "node-1", "--name", "Renamed"]);
    await run(command, ["node", "move", "node-1", "--parent", "parent-2"]);
    await run(command, ["node", "move", "node-1", "--root"]);
    await run(command, ["node", "trash", "node-1", "--json"]);

    expect(browse).toHaveBeenCalledWith({
      parentNodeId: "parent-1",
      recursive: true,
      resourceKind: "univer",
      spaceId: "space-1",
      unitType: "sheet",
    });
    expect(find).toHaveBeenCalledWith({
      query: "quarterly plan",
      resourceKind: "blob",
      spaceId: "space-1",
    });
    expect(createNode).toHaveBeenCalledWith({
      name: "Folder",
      parentNodeId: "parent-1",
      spaceId: "space-1",
    });
    expect(renameNode).toHaveBeenCalledWith({ name: "Renamed", nodeId: "node-1" });
    expect(moveNode).toHaveBeenNthCalledWith(1, {
      nodeId: "node-1",
      parentNodeId: "parent-2",
    });
    expect(moveNode).toHaveBeenNthCalledWith(2, { nodeId: "node-1", parentNodeId: null });
    expect(trashNode).toHaveBeenCalledWith("node-1");
  });

  it("requires exactly one explicit Node move destination", async () => {
    const moveNode = vi.fn();
    const command = createSpaceCommand({ moveNode } as unknown as WorkspaceSpaceFeature);

    await expect(run(command, ["node", "move", "node-1"])).rejects.toThrow(/process\.exit/u);
    await expect(
      run(command, ["node", "move", "node-1", "--parent", "parent-1", "--root"]),
    ).rejects.toThrow(/process\.exit/u);
    expect(moveNode).not.toHaveBeenCalled();
  });

  it("maps all Worktree management options and lifecycle actions", async () => {
    const create = vi.fn(async () => ({ id: "wt-1" }));
    const update = vi.fn(async () => ({ id: "wt-1" }));
    const transition = vi.fn(
      async (_id: string, _action: "ready" | "reopen" | "merge" | "discard") => ({
        id: "wt-1",
      }),
    );
    const command = createWorktreeCommand({
      create,
      get: async () => ({ id: "wt-1" }),
      list: async () => [],
      transition,
      update,
    } as unknown as WorkspaceWorktreeFeature);

    await run(command, [
      "create",
      "--name",
      "Draft",
      "--scope",
      "space",
      "--space",
      "space-1",
      "--visibility",
      "space",
      "--idempotency-key",
      "key-1",
    ]);
    await run(command, ["update", "wt-1", "--name", "Renamed", "--visibility", "private"]);
    for (const action of ["ready", "reopen", "merge", "discard"] as const) {
      await run(command, [action, "wt-1"]);
    }

    expect(create).toHaveBeenCalledWith({
      idempotencyKey: "key-1",
      name: "Draft",
      scope: { kind: "space", spaceId: "space-1" },
      visibility: "space",
    });
    expect(update).toHaveBeenCalledWith("wt-1", { name: "Renamed", visibility: "private" });
    expect(transition.mock.calls.map((call) => call[1])).toEqual([
      "ready",
      "reopen",
      "merge",
      "discard",
    ]);
  });

  it("maps Unit add/create identities and target metadata", async () => {
    const add = vi.fn(async () => ({ unitId: "unit-1" }));
    const create = vi.fn(async () => ({ unitId: "unit-2" }));
    const command = createUnitCommand({
      add,
      create,
      list: async () => [],
    } as unknown as WorkspaceUnitFeature);

    await run(command, ["add", "--worktree", "wt-1", "--resource", "resource-1"]);
    await run(command, [
      "create",
      "--worktree",
      "wt-1",
      "--space",
      "space-1",
      "--type",
      "doc",
      "--name",
      "Brief",
      "--parent",
      "parent-1",
      "--idempotency-key",
      "unit-key",
    ]);

    expect(add).toHaveBeenCalledWith("wt-1", "resource-1");
    expect(create).toHaveBeenCalledWith({
      idempotencyKey: "unit-key",
      name: "Brief",
      parentNodeId: "parent-1",
      spaceId: "space-1",
      type: "doc",
      worktreeId: "wt-1",
    });
  });

  it("maps Blob upload/get/download without changing filenames or ids", async () => {
    const upload = vi.fn(async () => ({ uploadId: "upload-1" }));
    const get = vi.fn(async () => ({ resource: { resourceId: "resource-1" } }));
    const download = vi.fn(async () => ({ outputPath: "/tmp/output.bin" }));
    const command = createBlobCommand({ download, get, upload } as unknown as WorkspaceBlobFeature);

    await run(command, [
      "upload",
      "--file",
      "source.bin",
      "--space",
      "space-1",
      "--parent",
      "parent-1",
      "--name",
      "Archive",
      "--media-type",
      "application/zip",
      "--idempotency-key",
      "blob-key",
    ]);
    await run(command, ["get", "resource-1"]);
    await run(command, ["download", "output.bin", "--resource", "resource-1", "--force"]);

    expect(upload).toHaveBeenCalledWith({
      declaredMediaType: "application/zip",
      filePath: "source.bin",
      idempotencyKey: "blob-key",
      name: "Archive",
      parentNodeId: "parent-1",
      spaceId: "space-1",
    });
    expect(get).toHaveBeenCalledWith("resource-1");
    expect(download).toHaveBeenCalledWith({
      force: true,
      outputPath: "output.bin",
      resourceId: "resource-1",
    });
  });

  it("maps Asset download and Open review URL options", async () => {
    const download = vi.fn(async () => ({ outputPath: "asset.bin" }));
    const asset = createAssetCommand({ download } as unknown as WorkspaceAssetFeature);
    await run(asset, ["download", "asset.bin", "--id", "file-1", "--worktree", "wt-1", "--force"]);
    expect(download).toHaveBeenCalledWith({
      assetId: "file-1",
      force: true,
      outputPath: "asset.bin",
      worktreeId: "wt-1",
    });

    const createUrl = vi.fn(async () => ({
      openUrl: "https://viewer.test/worktrees?worktree=wt-1&unit=unit-1&view=agent",
      type: "sheet" as const,
      unitId: "unit-1",
      worktreeId: "wt-1",
    }));
    const open = createOpenCommand({ createUrl } as unknown as WorkspaceOpenFeature);
    const output = await run(open, [
      "--worktree",
      "wt-1",
      "--unit",
      "unit-1",
      "--viewer-url",
      "https://viewer.test",
      "--json",
    ]);
    expect(createUrl).toHaveBeenCalledWith({
      unitId: "unit-1",
      viewerBaseUrl: "https://viewer.test",
      worktreeId: "wt-1",
    });
    expect(JSON.parse(output)).toMatchObject({ success: true, data: { unitId: "unit-1" } });
  });
});

async function run(command: Command, args: readonly string[]): Promise<string> {
  let output = "";
  const configuration: OutputConfiguration = {
    writeErr: (text) => {
      output += text;
    },
    writeOut: (text) => {
      output += text;
    },
  };
  configure(command, configuration);
  const program = new Command("test").configureOutput(configuration).exitOverride();
  program.addCommand(command);
  await program.parseAsync([command.name(), ...args], { from: "user" });
  return output;
}

function configure(command: Command, output: OutputConfiguration): void {
  command.configureOutput(output);
  for (const child of command.commands) configure(child, output);
}
