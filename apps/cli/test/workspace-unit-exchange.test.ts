import type { OutputConfiguration } from "commander";
import { Command } from "commander";
import type { WorkspaceUnitExchangeFeature } from "@univerjs/univer-workspace-client-core";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceUnitExchangeCommands } from "../src/features/exchange/command.js";

describe("Workspace Unit exchange commands", () => {
  it("maps exact import options and preserves text presentation", async () => {
    const importFile = vi.fn(async () => ({
      committed: true as const,
      name: "Inventory",
      nodeId: "node-1",
      resourceId: "resource-1",
      sourcePath: "inventory.xlsx",
      type: "base" as const,
      unitId: "unit-1",
      worktreeId: "wt-1",
    }));
    const [command] = createWorkspaceUnitExchangeCommands({
      importFile,
      exportFile: vi.fn(),
    } as unknown as Pick<WorkspaceUnitExchangeFeature, "exportFile" | "importFile">);

    const output = await run(command!, [
      "--file",
      "inventory.xlsx",
      "--worktree",
      "wt-1",
      "--space",
      "space-1",
      "--type",
      "base",
      "--name",
      "Inventory",
      "--parent",
      "folder-1",
      "--idempotency-key",
      "key-1",
    ]);

    expect(importFile).toHaveBeenCalledWith({
      idempotencyKey: "key-1",
      name: "Inventory",
      parentNodeId: "folder-1",
      sourcePath: "inventory.xlsx",
      spaceId: "space-1",
      type: "base",
      worktreeId: "wt-1",
    });
    expect(output).toContain(
      "imported base unit-1 as Resource resource-1 on Node node-1 in wt-1",
    );
  });

  it("maps exact export input and preserves JSON presentation", async () => {
    const exportFile = vi.fn(async () => ({
      outputPath: " exact path/brief.docx ",
      type: "doc" as const,
      unitId: "doc-1",
      worktreeId: "wt-1",
    }));
    const [, command] = createWorkspaceUnitExchangeCommands({
      exportFile,
      importFile: vi.fn(),
    } as unknown as Pick<WorkspaceUnitExchangeFeature, "exportFile" | "importFile">);

    const output = await run(command!, [
      " exact path/brief.docx ",
      "--worktree",
      "wt-1",
      "--unit",
      "doc-1",
      "--json",
    ]);

    expect(exportFile).toHaveBeenCalledWith({
      outputPath: " exact path/brief.docx ",
      unitId: "doc-1",
      worktreeId: "wt-1",
    });
    expect(JSON.parse(output)).toEqual({
      outputPath: " exact path/brief.docx ",
      type: "doc",
      unitId: "doc-1",
      worktreeId: "wt-1",
    });
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
  command.configureOutput(configuration);
  const program = new Command("test").configureOutput(configuration).exitOverride();
  program.addCommand(command);
  await program.parseAsync([command.name(), ...args], { from: "user" });
  return output;
}
