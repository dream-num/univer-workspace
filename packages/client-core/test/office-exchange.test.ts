import { appendFile, mkdtemp, readFile, readdir, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ExchangeFormat, FormulaCalculationMode } from "@univerjs-pro/exchange-node";
import { UniverInstanceType } from "@univerjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceUnitExchangeFeature,
  WorkspaceApplicationError,
  inspectSource as inspectWorkspaceSource,
  type WorkspaceUnit,
  type WorkspaceUnitExchangeDependencies,
  type WorkspaceUnitType,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (path) => await rm(path, {
    force: true,
    recursive: true,
  })));
});

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

  it.each(["xls", "xlsx"])("preserves explicit Base import for controlled .%s", async (suffix) => {
    const importBuffer = vi.fn(async () => ({ id: "converted", name: "Imported" }));
    const feature = controlledFeature({ importBuffer });

    await expect(feature.importFile({
      sourcePath: `/session/input.${suffix}`,
      spaceId: "space-1",
      type: "base",
      worktreeId: "wt-1",
    }, importControls())).resolves.toMatchObject({ type: "base" });
    expect(importBuffer).toHaveBeenCalledWith(Buffer.from("abc"), {
      fileName: `input.${suffix}`,
      type: UniverInstanceType.UNIVER_BASE,
    });
  });

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

describe("Workspace Office operation controls", () => {
  it("stops an already-aborted import before conversion or Unit create", async () => {
    const controller = new AbortController();
    const reason = new Error("import cancelled");
    controller.abort(reason);
    const importFile = vi.fn();
    const importBuffer = vi.fn();
    const createUnit = vi.fn();
    const feature = createFeature({ createUnit, importBuffer, importFile });

    await expect(feature.importFile({
      sourcePath: "input.xlsx",
      spaceId: "space-1",
      worktreeId: "wt-1",
    }, { signal: controller.signal })).rejects.toBe(reason);
    expect(importFile).not.toHaveBeenCalled();
    expect(importBuffer).not.toHaveBeenCalled();
    expect(createUnit).not.toHaveBeenCalled();
  });

  it("awaits native import, then stops before create when cancellation arrives", async () => {
    const controller = new AbortController();
    const createUnit = vi.fn();
    const importBuffer = vi.fn(async () => {
      controller.abort(new Error("native import cancelled"));
      return { id: "converted", name: "Imported" };
    });
    const feature = controlledFeature({ createUnit, importBuffer });

    await expect(feature.importFile({
      sourcePath: "input.docx",
      spaceId: "space-1",
      worktreeId: "wt-1",
    }, { signal: controller.signal })).rejects.toThrow("native import cancelled");
    expect(importBuffer).toHaveBeenCalledOnce();
    expect(createUnit).not.toHaveBeenCalled();
  });

  it("forwards the optional signal only to controlled Unit create", async () => {
    const signal = new AbortController().signal;
    const createUnit = vi.fn(async (input: CreateInput) => createdUnit(input));
    const feature = controlledFeature({ createUnit });

    await feature.importFile({
      sourcePath: "input.docx",
      spaceId: "space-1",
      worktreeId: "wt-1",
    }, { signal });
    expect(createUnit).toHaveBeenCalledWith(expect.objectContaining({ worktreeId: "wt-1" }), signal);
  });

  it("stops an already-aborted export before target resolution", async () => {
    const controller = new AbortController();
    controller.abort(new Error("export cancelled"));
    const resolveRuntimeTarget = vi.fn();
    const exportUnitData = vi.fn();
    const exportToFile = vi.fn();
    const feature = createFeature({
      exportToFile,
      resolveRuntimeTarget,
      runtime: { exportUnitData },
    });

    await expect(feature.exportFile({
      outputPath: "output.xlsx",
      unitId: "unit-1",
      worktreeId: "wt-1",
    }, { signal: controller.signal })).rejects.toThrow("export cancelled");
    expect(resolveRuntimeTarget).not.toHaveBeenCalled();
    expect(exportUnitData).not.toHaveBeenCalled();
    expect(exportToFile).not.toHaveBeenCalled();
  });

  it("stops after target resolution when cancellation arrives", async () => {
    const controller = new AbortController();
    const exportUnitData = vi.fn();
    const exportToFile = vi.fn();
    const resolveRuntimeTarget = vi.fn(async () => {
      controller.abort(new Error("target cancelled"));
      return target("sheet");
    });
    const feature = createFeature({
      exportToFile,
      resolveRuntimeTarget,
      runtime: { exportUnitData },
    });

    await expect(feature.exportFile({
      outputPath: "output.xlsx",
      unitId: "unit-1",
      worktreeId: "wt-1",
    }, { signal: controller.signal })).rejects.toThrow("target cancelled");
    expect(resolveRuntimeTarget).toHaveBeenCalledWith(
      { unitId: "unit-1", worktreeId: "wt-1" },
      controller.signal,
    );
    expect(exportUnitData).not.toHaveBeenCalled();
    expect(exportToFile).not.toHaveBeenCalled();
  });

  it("forwards export signal and UnitData budgets without changing converter options", async () => {
    const signal = new AbortController().signal;
    const exactTarget = target("sheet");
    const resolveRuntimeTarget = vi.fn(async () => exactTarget);
    const exportUnitData = vi.fn(async () => ({ id: "unit-1" }) as never);
    const exportToFile = vi.fn(async () => undefined);
    const feature = createFeature({
      exportToFile,
      resolveRuntimeTarget,
      runtime: { exportUnitData },
    });

    await feature.exportFile({
      outputPath: "output.xlsx",
      unitId: "unit-1",
      worktreeId: "wt-1",
    }, {
      maxUnitDataBytes: 52_428_800,
      maxUnitDataDepth: 64,
      signal,
    });
    expect(resolveRuntimeTarget).toHaveBeenCalledWith(
      { unitId: "unit-1", worktreeId: "wt-1" },
      signal,
    );
    expect(exportUnitData).toHaveBeenCalledWith({
      maxValueBytes: 52_428_800,
      maxValueDepth: 64,
      signal,
      target: exactTarget,
    });
    expect(exportToFile).toHaveBeenCalledWith(
      { id: "unit-1" },
      "output.xlsx",
      {
        format: ExchangeFormat.XLSX,
        formulaCalculation: FormulaCalculationMode.FORCED,
        type: UniverInstanceType.UNIVER_SHEET,
      },
    );
  });
});

describe("Workspace controlled Office import", () => {
  it.each(INPUT_CASES)(
    "passes bounded .%s bytes as %s with the exact buffer options",
    async (suffix, type, options) => {
      for (const variant of suffixVariants(suffix)) {
        const bytes = Buffer.from("office");
        const sourcePath = `/session/report.${variant}`;
        const importBuffer = vi.fn(async () => ({ id: "converted", name: "Imported" }));
        const feature = createFeature({
          importBuffer,
          inspectSource: async () => ({
            byteSize: bytes.byteLength,
            originalFilename: basename(sourcePath),
            path: sourcePath,
          }),
          openSource: async function* () {
            yield bytes;
          },
        });

        await expect(feature.importFile({
          sourcePath,
          spaceId: "space-1",
          worktreeId: "wt-1",
        }, importControls())).resolves.toMatchObject({ type });
        expect(importBuffer).toHaveBeenCalledWith(bytes, {
          ...options,
          fileName: basename(sourcePath),
        });
      }
    },
  );

  it.each([
    ["growth", "abc", async (path: string) => await appendFile(path, "d")],
    ["truncation", "abcd", async (path: string) => await truncate(path, 3)],
  ] as const)("rejects source %s after inspection before native conversion", async (_label, initial, mutate) => {
    const directory = await temporaryDirectory();
    const sourcePath = join(directory, "source.xlsx");
    await writeFile(sourcePath, initial);
    const importBuffer = vi.fn();
    const createUnit = vi.fn();
    const feature = createFeature({
      createUnit,
      importBuffer,
      inspectSource: async (path, signal) => {
        const source = await inspectWorkspaceSource(path, signal);
        await mutate(path);
        return source;
      },
    });

    await expect(feature.importFile({
      sourcePath,
      spaceId: "space-1",
      worktreeId: "wt-1",
    }, importControls())).rejects.toMatchObject({ code: "workspace-blob-size-mismatch" });
    expect(importBuffer).not.toHaveBeenCalled();
    expect(createUnit).not.toHaveBeenCalled();
  });

  it("accepts the documented same-length replacement ceiling while bounding actual bytes", async () => {
    const directory = await temporaryDirectory();
    const sourcePath = join(directory, "source.xlsx");
    await writeFile(sourcePath, "old");
    const importBuffer = vi.fn(async (bytes: Buffer) => ({
      id: "converted",
      name: bytes.toString("utf8"),
    }));
    const feature = createFeature({
      importBuffer,
      inspectSource: async (path, signal) => {
        const source = await inspectWorkspaceSource(path, signal);
        await writeFile(path, "new");
        return source;
      },
    });

    await expect(feature.importFile({
      sourcePath,
      spaceId: "space-1",
      worktreeId: "wt-1",
    }, importControls())).resolves.toMatchObject({ name: "new" });
    expect(importBuffer.mock.calls[0]![0].toString("utf8")).toBe("new");
  });

  it("rejects an inspected source over the limit before opening it", async () => {
    const importBuffer = vi.fn();
    const createUnit = vi.fn();
    const openSource = vi.fn();
    const feature = createFeature({
      createUnit,
      importBuffer,
      inspectSource: async () => ({
        byteSize: 10,
        originalFilename: "large.xlsx",
        path: "/session/large.xlsx",
      }),
      openSource,
    });

    await expect(feature.importFile({
      sourcePath: "/session/large.xlsx",
      spaceId: "space-1",
      worktreeId: "wt-1",
    }, { ...importControls(), maxSourceBytes: 4 })).rejects.toMatchObject({
      code: "workspace-office-limit-exceeded",
      detail: { actual: 5, kind: "source-bytes", limit: 4 },
    });
    expect(openSource).not.toHaveBeenCalled();
    expect(importBuffer).not.toHaveBeenCalled();
    expect(createUnit).not.toHaveBeenCalled();
  });

  it("counts only the source limit plus one from a single oversized chunk", async () => {
    let closed = false;
    let yieldedChunks = 0;
    const importBuffer = vi.fn();
    const createUnit = vi.fn();
    const feature = createFeature({
      createUnit,
      importBuffer,
      inspectSource: async () => ({
        byteSize: 4,
        originalFilename: "large.xlsx",
        path: "/session/large.xlsx",
      }),
      openSource: async function* () {
        try {
          yieldedChunks += 1;
          yield Buffer.alloc(1024 * 1024);
          yieldedChunks += 1;
          yield Buffer.from("must not be read");
        } finally {
          closed = true;
        }
      },
    });

    await expect(feature.importFile({
      sourcePath: "/session/large.xlsx",
      spaceId: "space-1",
      worktreeId: "wt-1",
    }, { ...importControls(), maxSourceBytes: 4 })).rejects.toMatchObject({
      code: "workspace-office-limit-exceeded",
      detail: { actual: 5, kind: "source-bytes", limit: 4 },
    });
    expect(closed).toBe(true);
    expect(yieldedChunks).toBe(1);
    expect(importBuffer).not.toHaveBeenCalled();
    expect(createUnit).not.toHaveBeenCalled();
  });

  it("closes a cancelled source and starts no native conversion or create", async () => {
    const controller = new AbortController();
    let closed = false;
    const importBuffer = vi.fn();
    const createUnit = vi.fn();
    const feature = createFeature({
      createUnit,
      importBuffer,
      inspectSource: async () => ({
        byteSize: 2,
        originalFilename: "cancel.xlsx",
        path: "/session/cancel.xlsx",
      }),
      openSource: async function* () {
        try {
          yield Buffer.from("a");
          controller.abort(new Error("source cancelled"));
          yield Buffer.from("b");
        } finally {
          closed = true;
        }
      },
    });

    await expect(feature.importFile({
      sourcePath: "/session/cancel.xlsx",
      spaceId: "space-1",
      worktreeId: "wt-1",
    }, { ...importControls(), signal: controller.signal })).rejects.toThrow("source cancelled");
    expect(closed).toBe(true);
    expect(importBuffer).not.toHaveBeenCalled();
    expect(createUnit).not.toHaveBeenCalled();
  });

  it("awaits controlled native conversion and stops before create after cancellation", async () => {
    const controller = new AbortController();
    const createUnit = vi.fn();
    const importBuffer = vi.fn(async () => {
      controller.abort(new Error("native cancelled"));
      return { id: "converted", name: "Imported" };
    });
    const feature = controlledFeature({ createUnit, importBuffer });

    await expect(feature.importFile({
      sourcePath: "/session/input.xlsx",
      spaceId: "space-1",
      worktreeId: "wt-1",
    }, { ...importControls(), signal: controller.signal })).rejects.toThrow("native cancelled");
    expect(importBuffer).toHaveBeenCalledOnce();
    expect(createUnit).not.toHaveBeenCalled();
  });

  it.each([
    ["bytes", { maxUnitDataBytes: 12 }, { id: "converted", name: "A long imported name" }, "unit-data-bytes"],
    ["depth", { maxUnitDataDepth: 1 }, { id: "converted", nested: { value: true } }, "unit-data-depth"],
  ] as const)("rejects converted UnitData over the %s limit before create", async (_label, limit, imported, kind) => {
    const createUnit = vi.fn();
    const feature = controlledFeature({
      createUnit,
      importBuffer: vi.fn(async () => imported),
    });

    await expect(feature.importFile({
      idempotencyKey: "stable-confirmed-key",
      sourcePath: "/session/input.xlsx",
      spaceId: "space-1",
      worktreeId: "wt-1",
    }, { ...importControls(), ...limit })).rejects.toMatchObject({
      code: "workspace-office-limit-exceeded",
      detail: { kind },
    });
    expect(createUnit).not.toHaveBeenCalled();
  });

  it("applies the explicit name before the converted UnitData budget", async () => {
    const createUnit = vi.fn();
    const imported = { id: "converted", name: "A" };
    const feature = controlledFeature({
      createUnit,
      importBuffer: vi.fn(async () => imported),
    });

    await expect(feature.importFile({
      name: "A much longer explicit name",
      sourcePath: "/session/input.xlsx",
      spaceId: "space-1",
      worktreeId: "wt-1",
    }, {
      ...importControls(),
      maxUnitDataBytes: Buffer.byteLength(JSON.stringify(imported)),
    })).rejects.toMatchObject({ code: "workspace-office-limit-exceeded" });
    expect(createUnit).not.toHaveBeenCalled();
  });

  it("rejects malformed converted UnitData without invoking accessors", async () => {
    let getterCalls = 0;
    const imported = Object.defineProperty({ id: "converted" }, "name", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "secret";
      },
    });
    const createUnit = vi.fn();
    const feature = controlledFeature({
      createUnit,
      importBuffer: vi.fn(async () => imported),
    });

    await expect(feature.importFile({
      sourcePath: "/session/input.xlsx",
      spaceId: "space-1",
      worktreeId: "wt-1",
    }, importControls())).rejects.toMatchObject({
      code: "workspace-exchange-unit-data-invalid",
    });
    expect(getterCalls).toBe(0);
    expect(createUnit).not.toHaveBeenCalled();
  });

  it.each([
    "workspace-result-unknown",
    "workspace-result-mismatch",
    "workspace-invalid-response",
  ])("preserves dispatched create %s without reread, reconversion, or replay", async (code) => {
    const importBuffer = vi.fn(async () => ({ id: "converted", name: "Imported" }));
    const createUnit = vi.fn(async () => {
      throw Object.assign(new Error("create not confirmed"), { code });
    });
    const inspectSource = vi.fn(async () => ({
      byteSize: 3,
      originalFilename: "input.xlsx",
      path: "/session/input.xlsx",
    }));
    const openSource = vi.fn(async function* () {
      yield Buffer.from("abc");
    });
    const feature = createFeature({ createUnit, importBuffer, inspectSource, openSource });

    await expect(feature.importFile({
      idempotencyKey: "stable-key",
      sourcePath: "/session/input.xlsx",
      spaceId: "space-1",
      worktreeId: "wt-1",
    }, importControls())).rejects.toMatchObject({ code });
    expect(inspectSource).toHaveBeenCalledOnce();
    expect(openSource).toHaveBeenCalledOnce();
    expect(importBuffer).toHaveBeenCalledOnce();
    expect(createUnit).toHaveBeenCalledOnce();
  });

  it("returns a confirmed create even when its signal aborts after dispatch", async () => {
    const controller = new AbortController();
    const createUnit = vi.fn(async (input: CreateInput) => {
      controller.abort(new Error("late cancellation"));
      return createdUnit(input);
    });
    const feature = controlledFeature({ createUnit });

    await expect(feature.importFile({
      idempotencyKey: "stable-confirmed-key",
      sourcePath: "/session/input.xlsx",
      spaceId: "space-1",
      worktreeId: "wt-1",
    }, { ...importControls(), signal: controller.signal })).resolves.toMatchObject({
      committed: true,
      unitId: "unit-1",
    });
    expect(createUnit).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "stable-confirmed-key" }),
      controller.signal,
    );
  });
});

describe("Workspace controlled Office export", () => {
  it.each([
    [
      "sheet",
      "planning.xlsx",
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
      "brief.docx",
      { format: ExchangeFormat.DOCX, type: UniverInstanceType.UNIVER_DOC },
    ],
    [
      "slide",
      "deck.pptx",
      { format: ExchangeFormat.PPTX, type: UniverInstanceType.UNIVER_SLIDE },
    ],
  ] as const)("atomically exports %s with exact converter options", async (type, filename, options) => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, filename);
    const exactTarget = { ...target(type), revision: 17 };
    const unitData = { id: "unit-1", value: type };
    const resolveRuntimeTarget = vi.fn(async () => exactTarget);
    const exportUnitData = vi.fn(async () => unitData as never);
    const exportToBuffer = vi.fn(async () => Buffer.from(`office-${type}`));
    const exportToFile = vi.fn();
    const feature = createFeature({
      exportToBuffer,
      exportToFile,
      resolveRuntimeTarget,
      runtime: { exportUnitData },
    });

    await expect(feature.exportFile({
      outputPath,
      unitId: "unit-1",
      worktreeId: "wt-1",
    }, exportControls())).resolves.toEqual({ outputPath, type, unitId: "unit-1", worktreeId: "wt-1" });
    expect(resolveRuntimeTarget).toHaveBeenCalledOnce();
    expect(exportUnitData).toHaveBeenCalledWith({
      maxValueBytes: 52_428_800,
      maxValueDepth: 64,
      target: exactTarget,
    });
    expect(exportToBuffer).toHaveBeenCalledWith(unitData, options);
    expect(exportToFile).not.toHaveBeenCalled();
    expect(await readFile(outputPath, "utf8")).toBe(`office-${type}`);
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("fails an advanced selected head without re-resolving, converting, or writing", async () => {
    const exactTarget = { ...target("sheet"), revision: 17 };
    const resolveRuntimeTarget = vi.fn(async () => exactTarget);
    const exportToBuffer = vi.fn();
    const writeOutput = vi.fn();
    const exportUnitData = vi.fn(async ({ target: runtimeTarget }) => {
      expect(runtimeTarget).toBe(exactTarget);
      throw Object.assign(new Error("head advanced"), { code: "workspace-result-mismatch" });
    });
    const feature = createFeature({
      exportToBuffer,
      resolveRuntimeTarget,
      runtime: { exportUnitData },
      writeOutput,
    });

    await expect(feature.exportFile({
      outputPath: "output.xlsx",
      unitId: "unit-1",
      worktreeId: "wt-1",
    }, exportControls())).rejects.toMatchObject({ code: "workspace-result-mismatch" });
    expect(resolveRuntimeTarget).toHaveBeenCalledOnce();
    expect(exportUnitData).toHaveBeenCalledOnce();
    expect(exportToBuffer).not.toHaveBeenCalled();
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it("validates the exact exported UnitData identity and budget before native conversion", async () => {
    const exportToBuffer = vi.fn();
    const writeOutput = vi.fn();
    const mismatched = createFeature({
      exportToBuffer,
      runtime: { exportUnitData: async () => ({ id: "unit-other" }) as never },
      writeOutput,
    });
    await expect(mismatched.exportFile({
      outputPath: "output.xlsx",
      unitId: "unit-1",
      worktreeId: "wt-1",
    }, exportControls())).rejects.toMatchObject({ code: "workspace-exchange-unit-data-invalid" });

    const oversized = createFeature({
      exportToBuffer,
      runtime: { exportUnitData: async () => ({ id: "unit-1", value: "too large" }) as never },
      writeOutput,
    });
    await expect(oversized.exportFile({
      outputPath: "output.xlsx",
      unitId: "unit-1",
      worktreeId: "wt-1",
    }, { ...exportControls(), maxUnitDataBytes: 12 })).rejects.toMatchObject({
      code: "workspace-office-limit-exceeded",
      detail: { kind: "unit-data-bytes", limit: 12 },
    });
    expect(exportToBuffer).not.toHaveBeenCalled();
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it.each([
    ["bytes", "export-unit-data-bytes", "unit-data-bytes", 13, 12],
    ["depth", "export-unit-data-depth", "unit-data-depth", 3, 2],
  ] as const)("maps the real runtime %s limit before native conversion", async (_label, runtimeKind, officeKind, actual, limit) => {
    const exportToBuffer = vi.fn();
    const writeOutput = vi.fn();
    const feature = createFeature({
      exportToBuffer,
      runtime: {
        exportUnitData: async () => {
          throw new WorkspaceApplicationError(
            "workspace-content-limit-exceeded",
            "runtime private limit message",
            { actual, kind: runtimeKind, limit },
          );
        },
      },
      writeOutput,
    });

    await expect(feature.exportFile({
      outputPath: "output.xlsx",
      unitId: "unit-1",
      worktreeId: "wt-1",
    }, exportControls())).rejects.toMatchObject({
      code: "workspace-office-limit-exceeded",
      detail: { actual, kind: officeKind, limit },
    });
    expect(exportToBuffer).not.toHaveBeenCalled();
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it("awaits native conversion and starts no output after cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("native export cancelled");
    const writeOutput = vi.fn();
    const exportToBuffer = vi.fn(async () => {
      controller.abort(reason);
      return Buffer.from("converted");
    });
    const feature = createFeature({ exportToBuffer, writeOutput });

    await expect(feature.exportFile({
      outputPath: "output.xlsx",
      unitId: "unit-1",
      worktreeId: "wt-1",
    }, { ...exportControls(), signal: controller.signal })).rejects.toBe(reason);
    expect(exportToBuffer).toHaveBeenCalledOnce();
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it("rejects oversized native output before creating a destination", async () => {
    const writeOutput = vi.fn();
    const feature = createFeature({
      exportToBuffer: vi.fn(async () => Buffer.alloc(5)),
      writeOutput,
    });

    await expect(feature.exportFile({
      outputPath: "output.xlsx",
      unitId: "unit-1",
      worktreeId: "wt-1",
    }, { ...exportControls(), atomicOutput: { force: false, maxOutputBytes: 4 } })).rejects.toMatchObject({
      code: "workspace-office-limit-exceeded",
      detail: { actual: 5, kind: "output-bytes", limit: 4 },
    });
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it("protects an existing destination by default and replaces it only with force", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "output.xlsx");
    await writeFile(outputPath, "old");
    const exportToBuffer = vi.fn(async () => Buffer.from("new"));
    const feature = createFeature({ exportToBuffer });

    await expect(feature.exportFile({
      outputPath,
      unitId: "unit-1",
      worktreeId: "wt-1",
    }, exportControls())).rejects.toMatchObject({ code: "workspace-office-output-exists" });
    expect(await readFile(outputPath, "utf8")).toBe("old");
    await expect(feature.exportFile({
      outputPath,
      unitId: "unit-1",
      worktreeId: "wt-1",
    }, { ...exportControls(), atomicOutput: { force: true, maxOutputBytes: 52_428_800 } })).resolves.toMatchObject({
      outputPath,
    });
    expect(await readFile(outputPath, "utf8")).toBe("new");
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("does not clobber a destination that appears during native conversion", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "output.xlsx");
    const feature = createFeature({
      exportToBuffer: vi.fn(async () => {
        await writeFile(outputPath, "winner");
        return Buffer.from("loser");
      }),
    });

    await expect(feature.exportFile({
      outputPath,
      unitId: "unit-1",
      worktreeId: "wt-1",
    }, exportControls())).rejects.toMatchObject({ code: "workspace-office-output-exists" });
    expect(await readFile(outputPath, "utf8")).toBe("winner");
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps a confirmed atomic publication when cancellation arrives afterward", async () => {
    const controller = new AbortController();
    const writeOutput = vi.fn(async (input: Parameters<NonNullable<WorkspaceUnitExchangeDependencies["writeOutput"]>>[0]) => {
      const chunk = await input.content[Symbol.asyncIterator]().next();
      expect(Buffer.from(chunk.value!)).toEqual(Buffer.from("confirmed"));
      controller.abort(new Error("late export cancellation"));
      return { byteSize: chunk.value!.byteLength, outputPath: input.outputPath };
    });
    const feature = createFeature({
      exportToBuffer: vi.fn(async () => Buffer.from("confirmed")),
      writeOutput,
    });

    await expect(feature.exportFile({
      outputPath: "output.xlsx",
      unitId: "unit-1",
      worktreeId: "wt-1",
    }, { ...exportControls(), signal: controller.signal })).resolves.toMatchObject({
      outputPath: "output.xlsx",
    });
    expect(controller.signal.aborted).toBe(true);
    expect(writeOutput).toHaveBeenCalledOnce();
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

function importControls() {
  return {
    maxSourceBytes: 52_428_800,
    maxUnitDataBytes: 52_428_800,
    maxUnitDataDepth: 64,
  } as const;
}

function exportControls() {
  return {
    atomicOutput: { force: false, maxOutputBytes: 52_428_800 },
    maxUnitDataBytes: 52_428_800,
    maxUnitDataDepth: 64,
  } as const;
}

function controlledFeature(
  overrides: Partial<WorkspaceUnitExchangeDependencies> = {},
): WorkspaceUnitExchangeFeature {
  const bytes = Buffer.from("abc");
  return createFeature({
    importBuffer: async () => ({ id: "converted", name: "Imported" }),
    inspectSource: async (path) => ({
      byteSize: bytes.byteLength,
      originalFilename: basename(path),
      path,
    }),
    openSource: async function* () {
      yield bytes;
    },
    ...overrides,
  });
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "workspace-office-"));
  temporaryDirectories.push(path);
  return path;
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
