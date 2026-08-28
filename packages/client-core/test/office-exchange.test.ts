import { ExchangeFormat, FormulaCalculationMode } from "@univerjs-pro/exchange-node";
import { UniverInstanceType } from "@univerjs/core";
import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceUnitExchangeFeature,
  type WorkspaceUnit,
  type WorkspaceUnitExchangeDependencies,
  type WorkspaceUnitType,
} from "../src/index.js";

const INPUT_CASES = [
  ["xls", "sheet", { type: UniverInstanceType.UNIVER_SHEET }],
  [
    "xlsx",
    "sheet",
    {
      formulaCalculation: FormulaCalculationMode.FORCED,
      type: UniverInstanceType.UNIVER_SHEET,
    },
  ],
  ["doc", "doc", { type: UniverInstanceType.UNIVER_DOC }],
  ["docx", "doc", { type: UniverInstanceType.UNIVER_DOC }],
  ["ppt", "slide", { type: UniverInstanceType.UNIVER_SLIDE }],
  ["pptx", "slide", { type: UniverInstanceType.UNIVER_SLIDE }],
  [
    "pptm",
    "slide",
    { format: ExchangeFormat.PPTX, type: UniverInstanceType.UNIVER_SLIDE },
  ],
  [
    "ppsx",
    "slide",
    { format: ExchangeFormat.PPTX, type: UniverInstanceType.UNIVER_SLIDE },
  ],
  [
    "ppsm",
    "slide",
    { format: ExchangeFormat.PPTX, type: UniverInstanceType.UNIVER_SLIDE },
  ],
  [
    "potx",
    "slide",
    { format: ExchangeFormat.PPTX, type: UniverInstanceType.UNIVER_SLIDE },
  ],
] as const;

const UNIT_TYPES = ["sheet", "base", "doc", "slide"] as const;

describe("Workspace Office exchange policy", () => {
  it.each(INPUT_CASES)(
    "infers .%s as %s with exact converter options for every suffix case",
    async (suffix, type, options) => {
      for (const variant of suffixVariants(suffix)) {
        const importFile = vi.fn(async () => ({ id: "converted", name: "Imported" }));
        const createUnit = vi.fn(async (input: CreateInput) => createdUnit(input));
        const feature = createFeature({ createUnit, importFile });

        await expect(
          feature.importFile({
            sourcePath: `exact path/report.${variant}`,
            spaceId: "space-1",
            worktreeId: "wt-1",
          }),
        ).resolves.toMatchObject({ sourcePath: `exact path/report.${variant}`, type });
        expect(importFile).toHaveBeenCalledOnce();
        expect(importFile).toHaveBeenCalledWith(`exact path/report.${variant}`, options);
        expect(createUnit).toHaveBeenCalledOnce();
      }
    },
  );

  it.each(["xls", "xlsx"])("accepts Sheet and Base for .%s without type fallback", async (suffix) => {
    for (const type of ["sheet", "base"] as const) {
      const importFile = vi.fn(async () => ({ id: "converted", name: "Imported" }));
      const feature = createFeature({ importFile });
      await feature.importFile({
        sourcePath: `input.${suffix}`,
        spaceId: "space-1",
        type,
        worktreeId: "wt-1",
      });
      expect(importFile).toHaveBeenCalledWith(
        `input.${suffix}`,
        type === "base"
          ? { type: UniverInstanceType.UNIVER_BASE }
          : suffix === "xlsx"
            ? {
                formulaCalculation: FormulaCalculationMode.FORCED,
                type: UniverInstanceType.UNIVER_SHEET,
              }
            : { type: UniverInstanceType.UNIVER_SHEET },
      );
    }
  });

  it.each(INPUT_CASES)("accepts only compatible explicit types for .%s", async (suffix, inferred) => {
    for (const type of UNIT_TYPES) {
      const importFile = vi.fn(async () => ({ id: "converted", name: "Imported" }));
      const createUnit = vi.fn(async (input: CreateInput) => createdUnit(input));
      const feature = createFeature({ createUnit, importFile });
      const allowed =
        (inferred === "sheet" && (type === "sheet" || type === "base")) || type === inferred;
      const result = feature.importFile({
        sourcePath: `input.${suffix}`,
        spaceId: "space-1",
        type,
        worktreeId: "wt-1",
      });
      if (allowed) {
        await expect(result).resolves.toMatchObject({ type });
        expect(importFile).toHaveBeenCalledOnce();
        expect(createUnit).toHaveBeenCalledOnce();
      } else {
        await expect(result).rejects.toMatchObject({
          code: "workspace-exchange-import-format-unsupported",
        });
        expect(importFile).not.toHaveBeenCalled();
        expect(createUnit).not.toHaveBeenCalled();
      }
    }
  });

  it.each(["input", "input.", "input.csv", "input.pdf"])(
    "rejects unsupported source %s before conversion",
    async (sourcePath) => {
      const importFile = vi.fn();
      const createUnit = vi.fn();
      const feature = createFeature({ createUnit, importFile });
      await expect(
        feature.importFile({ sourcePath, spaceId: "space-1", worktreeId: "wt-1" }),
      ).rejects.toMatchObject({ code: "workspace-exchange-import-format-unsupported" });
      expect(importFile).not.toHaveBeenCalled();
      expect(createUnit).not.toHaveBeenCalled();
    },
  );
});

describe("Workspace Office import workflow", () => {
  it.each([
    ["explicit", { name: "  Explicit  " }, { name: "Converted", title: "Title" }, "  Explicit  "],
    ["converted name", {}, { name: "  Converted  ", title: "Title" }, "  Converted  "],
    ["converted title", {}, { name: " ", title: "  Title  " }, "  Title  "],
    ["fallback", {}, { name: "", title: "\t" }, "Imported doc"],
    ["blank explicit", { name: "  " }, { name: "Converted" }, "Converted"],
  ] as const)("uses %s name precedence without rewriting non-empty values", async (_, input, imported, expected) => {
    const createUnit = vi.fn(async (createInput: CreateInput) => createdUnit(createInput));
    const importFile = vi.fn(async () => imported);
    const feature = createFeature({ createUnit, importFile });

    await expect(
      feature.importFile({
        ...input,
        sourcePath: "report.docx",
        spaceId: "space-1",
        worktreeId: "wt-1",
      }),
    ).resolves.toMatchObject({ name: expected, type: "doc" });
    const initialData = createUnit.mock.calls[0]![0].initialData;
    const inputName = "name" in input ? input.name : undefined;
    expect(createUnit.mock.calls[0]![0].name).toBe(expected);
    if (inputName?.trim()) expect(initialData).toEqual({ ...imported, name: inputName });
    else expect(initialData).toEqual(imported);
  });

  it("passes the exact create identity, converted payload, parent, and idempotency key", async () => {
    const converted = { id: "converted", resources: [{ name: "resource" }], title: "Deck" };
    const createUnit = vi.fn(async (input: CreateInput) => createdUnit(input));
    const feature = createFeature({ createUnit, importFile: async () => converted });

    await expect(
      feature.importFile({
        idempotencyKey: " exact-key ",
        parentNodeId: " parent-1 ",
        sourcePath: " deck.PPTX",
        spaceId: " space-1 ",
        type: "slide",
        worktreeId: " wt-1 ",
      }),
    ).resolves.toEqual({
      committed: true,
      name: "Deck",
      nodeId: "node-1",
      resourceId: "resource-1",
      sourcePath: " deck.PPTX",
      type: "slide",
      unitId: "unit-1",
      worktreeId: " wt-1 ",
    });
    expect(createUnit).toHaveBeenCalledWith({
      idempotencyKey: " exact-key ",
      initialData: converted,
      name: "Deck",
      parentNodeId: " parent-1 ",
      spaceId: " space-1 ",
      type: "slide",
      worktreeId: " wt-1 ",
    });
  });

  it("omits optional create fields and forwards the same supplied idempotency key on retry", async () => {
    const createUnit = vi.fn(async (input: CreateInput) => createdUnit(input));
    const feature = createFeature({ createUnit });
    const input = {
      idempotencyKey: "stable-import",
      sourcePath: "input.doc",
      spaceId: "space-1",
      worktreeId: "wt-1",
    } as const;
    await feature.importFile(input);
    await feature.importFile(input);
    expect(createUnit).toHaveBeenCalledTimes(2);
    expect(createUnit.mock.calls.map(([value]) => value.idempotencyKey)).toEqual([
      "stable-import",
      "stable-import",
    ]);
    expect(createUnit.mock.calls[0]![0]).not.toHaveProperty("parentNodeId");
  });

  it("does not create when native import rejects", async () => {
    const failure = new Error("conversion failed");
    const createUnit = vi.fn();
    const feature = createFeature({
      createUnit,
      importFile: vi.fn(async () => {
        throw failure;
      }),
    });
    await expect(
      feature.importFile({
        sourcePath: "input.docx",
        spaceId: "space-1",
        worktreeId: "wt-1",
      }),
    ).rejects.toBe(failure);
    expect(createUnit).not.toHaveBeenCalled();
  });

  it.each([
    ["Worktree", { worktreeId: "wt-other" }],
    ["source", { source: "trunk" }],
    ["type", { type: "doc" }],
    ["name", { name: "Other" }],
    ["Space", { target: { parentNodeId: "folder-1", spaceId: "space-other" } }],
    ["parent", { target: { parentNodeId: "folder-other", spaceId: "space-1" } }],
  ] as const)("rejects a created Unit with mismatched %s identity", async (_, override) => {
    const importFile = vi.fn(async () => ({ id: "converted", name: "Imported" }));
    const createUnit = vi.fn(async (input: CreateInput) => createdUnit(input, override));
    const feature = createFeature({ createUnit, importFile });
    const result = feature.importFile({
      parentNodeId: "folder-1",
      sourcePath: "input.xlsx",
      spaceId: "space-1",
      worktreeId: "wt-1",
    });
    await expect(result).rejects.toMatchObject({ code: "workspace-result-mismatch" });
    expect(importFile).toHaveBeenCalledOnce();
    expect(createUnit).toHaveBeenCalledOnce();
  });
});

describe("Workspace Office export workflow", () => {
  it.each([
    [
      "sheet",
      "planning.XLSX",
      {
        format: ExchangeFormat.XLSX,
        formulaCalculation: FormulaCalculationMode.FORCED,
        type: UniverInstanceType.UNIVER_SHEET,
      },
    ],
    [
      "base",
      "inventory.xlsx",
      { format: ExchangeFormat.XLSX, type: UniverInstanceType.UNIVER_BASE },
    ],
    [
      "doc",
      "brief.DoCx",
      { format: ExchangeFormat.DOCX, type: UniverInstanceType.UNIVER_DOC },
    ],
    [
      "slide",
      "deck.PPTX",
      { format: ExchangeFormat.PPTX, type: UniverInstanceType.UNIVER_SLIDE },
    ],
  ] as const)("exports %s with the exact target, path, and options", async (type, outputPath, options) => {
    const exactTarget = { ...target(type), revision: 17 };
    const unitData = { id: "unit-1", resources: [{ id: "resource" }], styles: { style: 1 } };
    const resolveRuntimeTarget = vi.fn(async () => exactTarget);
    const exportUnitData = vi.fn(async () => unitData as never);
    const exportToFile = vi.fn(async () => undefined);
    const feature = createFeature({
      exportToFile,
      resolveRuntimeTarget,
      runtime: { exportUnitData },
    });

    await expect(
      feature.exportFile({ outputPath, unitId: "unit-1", worktreeId: "wt-1" }),
    ).resolves.toEqual({ outputPath, type, unitId: "unit-1", worktreeId: "wt-1" });
    expect(resolveRuntimeTarget).toHaveBeenCalledWith({ unitId: "unit-1", worktreeId: "wt-1" });
    expect(exportUnitData).toHaveBeenCalledWith({ target: exactTarget });
    expect(exportToFile).toHaveBeenCalledWith(unitData, outputPath, options);
  });

  it("preserves resolver failure before all other validation and side effects", async () => {
    const order: string[] = [];
    const failure = new Error("target unavailable");
    const feature = createFeature({
      exportToFile: vi.fn(async () => order.push("write") as never),
      resolveRuntimeTarget: vi.fn(async () => {
        order.push("resolve");
        throw failure;
      }),
      runtime: {
        exportUnitData: vi.fn(async () => order.push("runtime") as never),
      },
    });
    await expect(
      feature.exportFile({ outputPath: "bad.csv", unitId: "unit-1", worktreeId: "wt-1" }),
    ).rejects.toBe(failure);
    expect(order).toEqual(["resolve"]);
  });

  it("rejects Board before output suffix inference and runtime export", async () => {
    const exportUnitData = vi.fn();
    const exportToFile = vi.fn();
    const feature = createFeature({
      exportToFile,
      resolveRuntimeTarget: async () => target("board"),
      runtime: { exportUnitData },
    });
    await expect(
      feature.exportFile({ outputPath: "bad.csv", unitId: "unit-1", worktreeId: "wt-1" }),
    ).rejects.toMatchObject({ code: "workspace-unit-type-unsupported" });
    expect(exportUnitData).not.toHaveBeenCalled();
    expect(exportToFile).not.toHaveBeenCalled();
  });

  it.each(["output", "output.", "output.xls", "output.doc", "output.ppt", "output.csv"])(
    "rejects unsupported output %s before runtime export",
    async (outputPath) => {
      const exportUnitData = vi.fn();
      const exportToFile = vi.fn();
      const feature = createFeature({
        exportToFile,
        runtime: { exportUnitData },
      });
      await expect(
        feature.exportFile({ outputPath, unitId: "unit-1", worktreeId: "wt-1" }),
      ).rejects.toMatchObject({ code: "workspace-exchange-export-format-unsupported" });
      expect(exportUnitData).not.toHaveBeenCalled();
      expect(exportToFile).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["sheet", "output.docx"],
    ["sheet", "output.pptx"],
    ["base", "output.docx"],
    ["base", "output.pptx"],
    ["doc", "output.xlsx"],
    ["doc", "output.pptx"],
    ["slide", "output.xlsx"],
    ["slide", "output.docx"],
  ] as const)("rejects %s to %s before runtime export", async (type, outputPath) => {
    const exportUnitData = vi.fn();
    const exportToFile = vi.fn();
    const feature = createFeature({
      exportToFile,
      resolveRuntimeTarget: async () => target(type),
      runtime: { exportUnitData },
    });
    await expect(
      feature.exportFile({ outputPath, unitId: "unit-1", worktreeId: "wt-1" }),
    ).rejects.toMatchObject({ code: "workspace-exchange-export-format-mismatch" });
    expect(exportUnitData).not.toHaveBeenCalled();
    expect(exportToFile).not.toHaveBeenCalled();
  });

  it.each([null, [], "unit-1", 1, {}, { id: "unit-other" }])(
    "rejects invalid exported UnitData %# without writing",
    async (unitData) => {
      const exportToFile = vi.fn();
      const feature = createFeature({
        exportToFile,
        runtime: { exportUnitData: async () => unitData as never },
      });
      await expect(
        feature.exportFile({
          outputPath: "planning.xlsx",
          unitId: "unit-1",
          worktreeId: "wt-1",
        }),
      ).rejects.toMatchObject({ code: "workspace-exchange-unit-data-invalid" });
      expect(exportToFile).not.toHaveBeenCalled();
    },
  );

  it("propagates runtime and writer failures without retry or fallback", async () => {
    const runtimeFailure = new Error("runtime failed");
    const runtimeWriter = vi.fn();
    const runtime = vi.fn(async () => {
      throw runtimeFailure;
    });
    await expect(
      createFeature({ exportToFile: runtimeWriter, runtime: { exportUnitData: runtime } }).exportFile({
        outputPath: "planning.xlsx",
        unitId: "unit-1",
        worktreeId: "wt-1",
      }),
    ).rejects.toBe(runtimeFailure);
    expect(runtime).toHaveBeenCalledOnce();
    expect(runtimeWriter).not.toHaveBeenCalled();

    const writerFailure = new Error("writer failed");
    const writer = vi.fn(async () => {
      throw writerFailure;
    });
    const successfulRuntime = vi.fn(async () => ({ id: "unit-1" }) as never);
    await expect(
      createFeature({ exportToFile: writer, runtime: { exportUnitData: successfulRuntime } }).exportFile({
        outputPath: "planning.xlsx",
        unitId: "unit-1",
        worktreeId: "wt-1",
      }),
    ).rejects.toBe(writerFailure);
    expect(successfulRuntime).toHaveBeenCalledOnce();
    expect(writer).toHaveBeenCalledOnce();
  });
});

type CreateInput = Parameters<WorkspaceUnitExchangeDependencies["createUnit"]>[0];

function createFeature(
  overrides: Partial<WorkspaceUnitExchangeDependencies> = {},
): WorkspaceUnitExchangeFeature {
  return new WorkspaceUnitExchangeFeature({
    createUnit: async (input) => createdUnit(input),
    exportToFile: async () => undefined,
    importFile: async () => ({ id: "converted", name: "Imported" }),
    resolveRuntimeTarget: async () => target("sheet"),
    runtime: { exportUnitData: async () => ({ id: "unit-1" }) as never },
    ...overrides,
  });
}

function createdUnit(input: CreateInput, overrides: Partial<WorkspaceUnit> = {}): WorkspaceUnit {
  return {
    activationState: "notApplicable",
    change: "added",
    draftHeadRevision: 0,
    mergeResult: "pending",
    name: input.name,
    nodeId: "node-1",
    resourceId: "resource-1",
    source: "worktree",
    target: { parentNodeId: input.parentNodeId ?? null, spaceId: input.spaceId },
    type: input.type,
    unitId: "unit-1",
    worktreeId: input.worktreeId,
    ...overrides,
  };
}

function target(type: WorkspaceUnitType) {
  return {
    origin: "https://workspace.example.com",
    revision: 3,
    scope: { kind: "worktree" as const, worktreeId: "wt-1" },
    unitId: "unit-1",
    unitType: type,
  };
}

function suffixVariants(suffix: string): readonly string[] {
  return [suffix, `${suffix[0]!.toUpperCase()}${suffix.slice(1)}`, suffix.toUpperCase()];
}
