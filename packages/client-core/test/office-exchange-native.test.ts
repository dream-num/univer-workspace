import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportToBuffer } from "@univerjs-pro/exchange-node";
import { LocaleType, UniverInstanceType } from "@univerjs/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  WorkspaceUnitExchangeFeature,
  type WorkspaceUnitExchangeDependencies,
  type WorkspaceUnitType,
} from "../src/index.js";
import { UNIVER_LICENSE, UNIVER_LICENSE_KEY } from "./license.js";

type OfficeType = Exclude<WorkspaceUnitType, "board" | "pdf">;
type CreateInput = Parameters<WorkspaceUnitExchangeDependencies["createUnit"]>[0];

const CASES = [
  ["xlsx", "sheet", UniverInstanceType.UNIVER_SHEET, sheetData()],
  ["docx", "doc", UniverInstanceType.UNIVER_DOC, docData()],
  ["pptx", "slide", UniverInstanceType.UNIVER_SLIDE, slideData()],
] as const;

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "workspace-office-exchange-"));
});
afterAll(async () => {
  await rm(directory, { force: true, recursive: true });
});

describe("Workspace Office exchange with the native binding", () => {
  it.each(CASES)(
    "imports %s bytes and file to equal Unit data",
    async (format, type, instanceType, data) => {
      const bytes = await exportToBuffer(
        data as never,
        {
          format,
          license: UNIVER_LICENSE,
          licenseKey: UNIVER_LICENSE_KEY,
          type: instanceType,
        } as never,
      );
      const sourcePath = join(directory, `input.${format}`);
      await writeFile(sourcePath, bytes);
      const created: CreateInput[] = [];
      const feature = featureFor(type, {
        createUnit: async (input) => (created.push(input), createdUnit(input)),
      });
      const base = { spaceId: "space-1", worktreeId: "wt-1" };

      const fromFile = await feature.importFile({ ...base, sourcePath });
      const fromBuffer = await feature.importBuffer({
        ...base,
        bytes: new Uint8Array(await readFile(sourcePath)),
        fileName: `input.${format}`,
      });

      expect(created).toHaveLength(2);
      expect(stable(created[1]!)).toEqual(stable(created[0]!));
      expect(created[0]!.type).toBe(type);
      expect(fromBuffer).toEqual({ ...withoutSourcePath(fromFile), fileName: `input.${format}` });
    },
  );

  it.each(CASES)("exports %s bytes and file to equal Unit data", async (format, type) => {
    const feature = featureFor(type);
    const outputPath = join(directory, `output.${format}`);
    await feature.exportFile({ outputPath, unitId: "unit-1", worktreeId: "wt-1" });
    const exported = await feature.exportBuffer({ format, unitId: "unit-1", worktreeId: "wt-1" });
    expect(exported).toMatchObject({ format, type, unitId: "unit-1", worktreeId: "wt-1" });
    expect(exported.bytes.byteLength).toBeGreaterThan(0);

    const created: CreateInput[] = [];
    const importer = featureFor(type, {
      createUnit: async (input) => (created.push(input), createdUnit(input)),
    });
    const base = { spaceId: "space-1", worktreeId: "wt-1" };
    await importer.importFile({ ...base, sourcePath: outputPath });
    await importer.importBuffer({ ...base, bytes: exported.bytes, fileName: `output.${format}` });
    expect(stable(created[1]!)).toEqual(stable(created[0]!));
  });

  it("uses the per-operation license without touching the process configuration", async () => {
    const configureExchange = vi.fn(async () => undefined);
    const bad = featureFor("sheet", {
      configureExchange,
      license: "bad",
      licenseKey: "bad",
      licenseMode: "per-operation",
    });
    await expect(
      bad.exportBuffer({ format: "xlsx", unitId: "unit-1", worktreeId: "wt-1" }),
    ).rejects.toMatchObject({
      code: "LICENSE_INVALID",
    });
    expect(configureExchange).not.toHaveBeenCalled();

    const good = featureFor("sheet", {
      configureExchange,
      license: ` ${UNIVER_LICENSE}\n`,
      licenseKey: ` ${UNIVER_LICENSE_KEY} `,
      licenseMode: "per-operation",
    });
    await expect(
      good.exportBuffer({ format: "xlsx", unitId: "unit-1", worktreeId: "wt-1" }),
    ).resolves.toMatchObject({
      format: "xlsx",
    });
    expect(configureExchange).not.toHaveBeenCalled();

    const processMode = featureFor("sheet", { configureExchange });
    await processMode.exportBuffer({ format: "xlsx", unitId: "unit-1", worktreeId: "wt-1" });
    expect(configureExchange).toHaveBeenCalledOnce();
  });

  it("exports on the free tier in per-operation mode without a license", async () => {
    const feature = featureFor("sheet", {
      license: "",
      licenseKey: "",
      licenseMode: "per-operation",
    });
    const exported = await feature.exportBuffer({
      format: "xlsx",
      unitId: "unit-1",
      worktreeId: "wt-1",
    });
    expect(exported.bytes.byteLength).toBeGreaterThan(0);
  });

  it.each([
    ["license", { license: UNIVER_LICENSE, licenseKey: "" }],
    ["licenseKey", { license: "", licenseKey: UNIVER_LICENSE_KEY }],
  ])("rejects a per-operation pair with only %s", (_name, pair) => {
    expect(() => featureFor("sheet", { ...pair, licenseMode: "per-operation" })).toThrowError(
      expect.objectContaining({ code: "workspace-exchange-license-incomplete" }),
    );
  });

  it.each([
    ["doc", "xlsx"],
    ["sheet", "docx"],
    ["slide", "xlsx"],
  ] as const)("rejects exporting a %s Unit as %s like exportFile", async (type, format) => {
    const feature = featureFor(type);
    const fileError = await feature
      .exportFile({
        outputPath: join(directory, `bad.${format}`),
        unitId: "unit-1",
        worktreeId: "wt-1",
      })
      .catch((error: unknown) => error);
    await expect(
      feature.exportBuffer({ format, unitId: "unit-1", worktreeId: "wt-1" }),
    ).rejects.toMatchObject({ code: "workspace-exchange-export-format-mismatch" });
    expect(fileError).toMatchObject({ code: "workspace-exchange-export-format-mismatch" });
  });

  it("rejects Board Units like exportFile", async () => {
    const feature = featureFor("board");
    await expect(
      feature.exportFile({
        outputPath: join(directory, "b.xlsx"),
        unitId: "unit-1",
        worktreeId: "wt-1",
      }),
    ).rejects.toMatchObject({ code: "workspace-unit-type-unsupported" });
    await expect(
      feature.exportBuffer({ format: "xlsx", unitId: "unit-1", worktreeId: "wt-1" }),
    ).rejects.toMatchObject({ code: "workspace-unit-type-unsupported" });
  });
});

// The converter mints random ids on every import: the Unit id and the key of the
// per-sheet sparkline resource. Drop both before comparing.
function stable(input: CreateInput): unknown {
  const {
    id: _id,
    resources,
    ...initialData
  } = input.initialData as {
    readonly id?: string;
    readonly resources?: readonly { readonly data: string; readonly name: string }[];
  };
  return {
    ...input,
    initialData: {
      ...initialData,
      resources: resources?.map((resource) =>
        resource.name === "SHEET_SPARKLINE_PLUGIN"
          ? { ...resource, data: Object.values(JSON.parse(resource.data)) }
          : resource,
      ),
    },
  };
}

function withoutSourcePath<T extends { readonly sourcePath: string }>(value: T) {
  const { sourcePath: _sourcePath, ...rest } = value;
  return rest;
}

function featureFor(
  type: OfficeType | "board",
  overrides: Partial<WorkspaceUnitExchangeDependencies> = {},
): WorkspaceUnitExchangeFeature {
  const data = CASES.find((entry) => entry[1] === type)?.[3] ?? sheetData();
  return new WorkspaceUnitExchangeFeature({
    createUnit: async (input) => createdUnit(input),
    license: UNIVER_LICENSE,
    licenseKey: UNIVER_LICENSE_KEY,
    resolveImageAsset: async () => {
      throw new Error("Unexpected Asset request");
    },
    resolveRuntimeTarget: async () =>
      ({
        origin: "https://workspace.example.com",
        revision: 1,
        scope: { kind: "worktree" as const, worktreeId: "wt-1" },
        unitId: "unit-1",
        unitType: type,
      }) as never,
    runtime: { exportUnitData: async () => ({ ...data, id: "unit-1" }) as never },
    ...overrides,
  });
}

function createdUnit(input: CreateInput) {
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
  } as never;
}

function sheetData() {
  return {
    appVersion: "",
    id: "sheet-unit",
    locale: LocaleType.EN_US,
    name: "Workbook",
    resources: [],
    rev: 1,
    sheetOrder: ["sheet-1"],
    sheets: {
      "sheet-1": {
        cellData: { 0: { 0: { v: "A1" } } },
        columnCount: 10,
        id: "sheet-1",
        name: "Sheet 1",
        rowCount: 20,
      },
    },
    styles: {},
  };
}

function docData() {
  return {
    id: "doc-unit",
    documentStyle: {},
    body: { dataStream: "Hello\r\n", paragraphs: [{ startIndex: 5 }] },
  };
}

function slideData() {
  return {
    id: "slide-unit",
    title: "Deck",
    pageSize: { width: 960, height: 540 },
    body: {
      pageOrder: ["page-1"],
      pages: {
        "page-1": {
          id: "page-1",
          pageType: 0,
          zIndex: 1,
          title: "Page 1",
          description: "",
          pageBackgroundFill: { rgb: "rgb(255,255,255)" },
          pageElements: {},
        },
      },
    },
  };
}
