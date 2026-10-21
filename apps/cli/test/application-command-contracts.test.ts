import { Readable, Writable } from "node:stream";
import { Command, type OutputConfiguration } from "commander";
import type {
  WorkspaceContentExecutionFeature,
  WorkspaceSpaceFeature,
  WorkspaceUnitFeature,
} from "@univerjs/univer-workspace-client-core";
import { describe, expect, it, vi } from "vitest";
import { createAssetCommand } from "../src/features/asset/command.js";
import type { WorkspaceAssetFeature } from "@univerjs/univer-workspace-client-core";
import { createAuthCommand, readPassword } from "../src/features/auth/command.js";
import type { WorkspaceAuth } from "../src/features/auth/session.js";
import { createBlobCommand } from "../src/features/blob/command.js";
import type { WorkspaceBlobFeature } from "@univerjs/univer-workspace-client-core";
import { createContentExecuteCommand } from "../src/features/content/command.js";
import { RepoContext } from "../src/repo-context.js";
import { createSpaceCommand } from "../src/features/space/command.js";
import { createUnitCommand } from "../src/features/unit/command.js";

describe("Workspace application Commander adapters", () => {
  it("keeps the authentication command names, options and browser default", async () => {
    const startCliLogin = vi.fn(async () => ({
      deviceCode: "test-device-code",
      expiresAt: 1_787_879_400_000,
      origin: "https://workspace.test",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://workspace.test/cli-login?userCode=ABCD-EFGH",
    }));
    const commands = authCommands({ startCliLogin } as unknown as WorkspaceAuth);
    expect(commands.map((command) => command.name())).toEqual(["login", "logout", "status"]);
    const login = commands[0]!;
    const help = login.helpInformation();
    expect(help).toContain("--complete");
    expect(help).toContain("--username <name>");
    expect(help).toContain("--password-stdin");

    const output = await run(login, ["--json"]);
    expect(startCliLogin).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output)).toEqual({
      expiresAt: "2026-08-28T01:10:00.000Z",
      nextCommand: "uvw auth login --complete",
      origin: "https://workspace.test",
      status: "authorization_required",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://workspace.test/cli-login?userCode=ABCD-EFGH",
    });
    expect(output).not.toContain("test-device-code");
  });

  it("rejects incompatible authentication options before entering the facade", async () => {
    const facade = {
      completeCliLogin: vi.fn(),
      login: vi.fn(),
      pendingCliLogin: vi.fn(),
      startCliLogin: vi.fn(),
    };
    await expect(
      run(authCommands(facade as unknown as WorkspaceAuth)[0]!, [
        "--complete",
        "--username",
        "alice",
      ]),
    ).rejects.toThrow(/process\.exit/u);
    await expect(
      run(authCommands(facade as unknown as WorkspaceAuth)[0]!, ["--password-stdin"]),
    ).rejects.toThrow(/process\.exit/u);
    expect(facade.login).not.toHaveBeenCalled();
    expect(facade.startCliLogin).not.toHaveBeenCalled();
  });

  it("keeps password stdin and terminal boundaries", async () => {
    const stderr = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const piped = Object.assign(Readable.from([["test", "password"].join("-")]), {
      isTTY: false,
    });
    await expect(readPassword("stdin", { stderr, stdin: piped })).resolves.toBe(
      ["test", "password"].join("-"),
    );
    await expect(
      readPassword("stdin", {
        stderr,
        stdin: Object.assign(Readable.from([]), { isTTY: true }),
      }),
    ).rejects.toMatchObject({ code: "workspace-password-input-invalid" });
    await expect(
      readPassword("interactive", {
        stderr,
        stdin: Object.assign(Readable.from([]), { isTTY: false }),
      }),
    ).rejects.toMatchObject({ code: "workspace-password-input-invalid" });
  });

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
    const browse = vi.fn(async () => [
      {
        nodeId: "node-1",
        resource: {
          kind: "univer",
          resourceId: "resource-1",
          unitId: "unit-1",
          unitType: "sheet",
        },
      },
    ]);
    const find = vi.fn(async () => []);
    const createNode = vi.fn(async () => ({ nodeId: "node-1" }));
    const moveNode = vi.fn(async () => ({ nodeId: "node-1" }));
    const renameNode = vi.fn(async () => ({ nodeId: "node-1" }));
    const trashNode = vi.fn(async () => ({ trashBatchId: "trash-1" }));
    const command = createSpaceCommand(
      {
        browse,
        createNode,
        find,
        list: async () => [],
        moveNode,
        renameNode,
        trashNode,
      } as unknown as WorkspaceSpaceFeature,
      repoContext(),
    );

    const browseOutput = await run(command, [
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
    expect(JSON.parse(browseOutput)).toMatchObject({
      nodes: [{ resource: { resourceId: "resource-1", unitId: "unit-1" } }],
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
    const command = createSpaceCommand({ moveNode } as unknown as WorkspaceSpaceFeature, repoContext());

    await expect(run(command, ["node", "move", "node-1"])).rejects.toThrow(/process\.exit/u);
    await expect(
      run(command, ["node", "move", "node-1", "--parent", "parent-1", "--root"]),
    ).rejects.toThrow(/process\.exit/u);
    expect(moveNode).not.toHaveBeenCalled();
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

  it("maps Blob replacement and returns its recorded identity and ETag", async () => {
    const result = { operationId: "replace-key", resourceId: "resource-1", etag: '"v2"' };
    const replace = vi.fn(async () => result);
    const command = createBlobCommand({ replace } as unknown as WorkspaceBlobFeature);
    const output = await run(command, [
      "replace",
      "--resource",
      "resource-1",
      "--file",
      "edited.bin",
      "--etag",
      '"v1"',
      "--idempotency-key",
      "replace-key",
      "--json",
    ]);
    expect(replace).toHaveBeenCalledWith({
      resourceId: "resource-1",
      filePath: "edited.bin",
      etag: '"v1"',
      idempotencyKey: "replace-key",
    });
    expect(JSON.parse(output)).toEqual({ replacement: result });
  });

  it.each(["--resource", "--file", "--etag", "--idempotency-key"])(
    "requires %s before attempting a Blob replacement",
    async (missing) => {
      const replace = vi.fn();
      const command = createBlobCommand({ replace } as unknown as WorkspaceBlobFeature);
      for (const child of command.commands) child.exitOverride();
      const pairs = [
        ["--resource", "resource-1"],
        ["--file", "edited.bin"],
        ["--etag", '"v1"'],
        ["--idempotency-key", "replace-key"],
      ];
      await expect(
        run(command, ["replace", ...pairs.filter(([flag]) => flag !== missing).flat()]),
      ).rejects.toMatchObject({ code: "commander.missingMandatoryOptionValue" });
      expect(replace).not.toHaveBeenCalled();
    },
  );

  it("maps Asset download options", async () => {
    const download = vi.fn(async () => ({ outputPath: "asset.bin" }));
    const asset = createAssetCommand({ download } as unknown as WorkspaceAssetFeature);
    await run(asset, ["download", "asset.bin", "--id", "file-1", "--worktree", "wt-1", "--force"]);
    expect(download).toHaveBeenCalledWith({
      assetId: "file-1",
      force: true,
      outputPath: "asset.bin",
      worktreeId: "wt-1",
    });
  });
});

function authCommands(auth: WorkspaceAuth): readonly Command[] {
  return createAuthCommand(auth).commands;
}

function repoContext(): RepoContext {
  return new RepoContext(
    { lookup: async () => ({ id: "looked-up", name: "Looked up" }) },
    async () => "https://workspace.test",
    {},
  );
}

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
