import type { OutputConfiguration } from "commander";
import { Command } from "commander";
import { UniverInstanceType } from "@univerjs/core";
import { describe, expect, it, vi } from "vitest";
import type { UnitExchange } from "@univer-cli/unit-exchange";
import { UnitExchangeFormat } from "@univer-cli/unit-exchange";
import { createWorkspaceUnitExchangeCommands } from "../src/features/exchange/command.js";
import {
  WorkspaceUnitExchangeFeature,
  type WorkspaceUnitExchangeDependencies,
} from "../src/features/exchange/exchange.js";
import type { WorkspaceUnit } from "../src/features/worktree/model.js";

describe("Workspace Unit exchange workflow", () => {
  it("imports XLSX as Sheet and stages the converted UnitData", async () => {
    const importFile = vi.fn(async () => ({
      data: { id: "imported-id", name: "Imported workbook", sheets: {} },
      type: UniverInstanceType.UNIVER_SHEET,
    }));
    const createUnit = vi.fn(async () => createdUnit());
    const feature = createFeature({
      createUnit,
      exchange: exchangeWith({ importFile }),
    });

    await expect(
      feature.importFile({
        idempotencyKey: "import-key",
        parentNodeId: "folder-1",
        sourcePath: "./planning.XLSX",
        spaceId: "space-1",
        worktreeId: "wt-1",
      }),
    ).resolves.toEqual({
      committed: true,
      name: "Imported workbook",
      nodeId: "node-1",
      resourceId: "resource-1",
      sourcePath: "./planning.XLSX",
      type: "sheet",
      unitId: "unit-1",
      worktreeId: "wt-1",
    });
    expect(importFile).toHaveBeenCalledWith({
      sourcePath: "./planning.XLSX",
      unitType: UniverInstanceType.UNIVER_SHEET,
    });
    expect(createUnit).toHaveBeenCalledWith({
      idempotencyKey: "import-key",
      initialData: { id: "imported-id", name: "Imported workbook", sheets: {} },
      name: "Imported workbook",
      parentNodeId: "folder-1",
      spaceId: "space-1",
      type: "sheet",
      worktreeId: "wt-1",
    });
  });

  it("supports explicit Base import and applies an explicit Unit name", async () => {
    const importFile = vi.fn(async () => ({
      data: { id: "base-1", name: "Source name" },
      type: UniverInstanceType.UNIVER_BASE,
    }));
    const createUnit = vi.fn(async () =>
      createdUnit({
        name: "Inventory",
        target: { parentNodeId: null, spaceId: "space-1" },
        type: "base",
      }),
    );
    const feature = createFeature({ createUnit, exchange: exchangeWith({ importFile }) });

    await feature.importFile({
      name: "Inventory",
      sourcePath: "inventory.xlsx",
      spaceId: "space-1",
      type: "base",
      worktreeId: "wt-1",
    });

    expect(importFile).toHaveBeenCalledWith({
      sourcePath: "inventory.xlsx",
      unitType: UniverInstanceType.UNIVER_BASE,
    });
    expect(createUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        initialData: { id: "base-1", name: "Inventory" },
        name: "Inventory",
        type: "base",
      }),
    );
  });

  it("exports the resolved Worktree head through the daemon and inferred format", async () => {
    const request = vi.fn(async () => ({ id: "unit-1", name: "Planning", sheets: {} }));
    const exportFile = vi.fn(async () => ({ outputPath: "planning.xlsx" }));
    const resolveRuntimeTarget = vi.fn(async () => target("sheet"));
    const feature = createFeature({
      daemon: { request },
      exchange: exchangeWith({ exportFile }),
      resolveRuntimeTarget,
    });

    await expect(
      feature.exportFile({
        outputPath: "planning.xlsx",
        unitId: "unit-1",
        worktreeId: "wt-1",
      }),
    ).resolves.toEqual({
      outputPath: "planning.xlsx",
      type: "sheet",
      unitId: "unit-1",
      worktreeId: "wt-1",
    });
    expect(resolveRuntimeTarget).toHaveBeenCalledWith({ unitId: "unit-1", worktreeId: "wt-1" });
    expect(request).toHaveBeenCalledWith("runtime.export-unit-data", {
      target: target("sheet"),
    });
    expect(exportFile).toHaveBeenCalledWith({
      format: UnitExchangeFormat.XLSX,
      outputPath: "planning.xlsx",
      unit: {
        data: { id: "unit-1", name: "Planning", sheets: {} },
        type: UniverInstanceType.UNIVER_SHEET,
      },
    });
  });

  it("rejects Board export before starting the daemon", async () => {
    const request = vi.fn();
    const feature = createFeature({
      daemon: { request },
      resolveRuntimeTarget: async () => target("board"),
    });
    await expect(
      feature.exportFile({ outputPath: "board.xlsx", unitId: "unit-1", worktreeId: "wt-1" }),
    ).rejects.toMatchObject({ code: "workspace-unit-type-unsupported" });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a Unit/output format mismatch before starting the daemon", async () => {
    const request = vi.fn();
    const feature = createFeature({
      daemon: { request },
      resolveRuntimeTarget: async () => target("doc"),
    });
    await expect(
      feature.exportFile({ outputPath: "brief.xlsx", unitId: "unit-1", worktreeId: "wt-1" }),
    ).rejects.toMatchObject({ code: "workspace-exchange-export-format-mismatch" });
    expect(request).not.toHaveBeenCalled();
  });

  it("maps production import/export command inputs and presentation", async () => {
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
    const exportFile = vi.fn(async () => ({
      outputPath: "brief.docx",
      type: "doc" as const,
      unitId: "doc-1",
      worktreeId: "wt-1",
    }));
    const [importCommand, exportCommand] = createWorkspaceUnitExchangeCommands({
      importFile,
      exportFile,
    } as unknown as WorkspaceUnitExchangeFeature);

    const imported = await run(importCommand!, [
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
    const exported = await run(exportCommand!, [
      "brief.docx",
      "--worktree",
      "wt-1",
      "--unit",
      "doc-1",
      "--json",
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
    expect(exportFile).toHaveBeenCalledWith({
      outputPath: "brief.docx",
      unitId: "doc-1",
      worktreeId: "wt-1",
    });
    expect(imported).toContain("imported base unit-1 as Resource resource-1");
    expect(JSON.parse(exported)).toMatchObject({ outputPath: "brief.docx", unitId: "doc-1" });
  });
});

function createFeature(
  overrides: Partial<WorkspaceUnitExchangeDependencies> = {},
): WorkspaceUnitExchangeFeature {
  return new WorkspaceUnitExchangeFeature({
    createUnit: async () => createdUnit(),
    daemon: { request: async () => ({ id: "unit-1" }) },
    exchange: exchangeWith(),
    resolveRuntimeTarget: async () => target("sheet"),
    ...overrides,
  });
}

function exchangeWith(
  overrides: { readonly exportFile?: unknown; readonly importFile?: unknown } = {},
): UnitExchange {
  return {
    importFile: async () => ({
      data: { id: "unit-1", name: "Imported", sheets: {}, sheetOrder: [] },
      type: UniverInstanceType.UNIVER_SHEET,
    }),
    exportFile: async (input) => ({ outputPath: input.outputPath }),
    ...overrides,
  } as UnitExchange;
}

function createdUnit(overrides: Partial<WorkspaceUnit> = {}): WorkspaceUnit {
  return {
    activationState: "notApplicable",
    change: "added",
    draftHeadRevision: 0,
    mergeResult: "pending",
    name: "Imported workbook",
    nodeId: "node-1",
    resourceId: "resource-1",
    source: "worktree",
    target: { parentNodeId: "folder-1", spaceId: "space-1" },
    type: "sheet",
    unitId: "unit-1",
    worktreeId: "wt-1",
    ...overrides,
  };
}

function target(type: "sheet" | "doc" | "slide" | "base" | "board") {
  return {
    origin: "https://workspace.example.com",
    revision: 3,
    scope: { kind: "worktree" as const, worktreeId: "wt-1" },
    unitId: "unit-1",
    unitType: type,
  };
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
  command.configureOutput(configuration);
  const program = new Command("test").configureOutput(configuration).exitOverride();
  program.addCommand(command);
  await program.parseAsync([command.name(), ...args], { from: "user" });
  return output;
}
