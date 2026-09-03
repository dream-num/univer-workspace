import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UnitPdfPrintResult } from "@univer-cli/unit-pdf-printer";
import type { UniverPrintPdfRuntime, UniverRenderUnit } from "@univer-cli/univer-render-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const print = vi.hoisted(() => vi.fn());

vi.mock("@univer-cli/unit-pdf-printer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@univer-cli/unit-pdf-printer")>()),
  createUnitPdfPrinter: () => ({ print }),
}));

import { WorkspacePrintPdfFeature } from "../src/print-pdf.js";

const temporaryDirectories: string[] = [];

beforeEach(() => print.mockReset());

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path) => await rm(path, { recursive: true })),
  );
});

describe("Workspace Unit PDF printing", () => {
  it("loads the selected scope, writes exact PDF bytes privately, and closes the runtime", async () => {
    const cwd = await temporaryDirectory();
    const source = sheetSource();
    const loader = { loadUnit: vi.fn(async () => source) };
    const close = vi.fn(async () => undefined);
    const runtime = { close } as unknown as UniverPrintPdfRuntime;
    const createRuntime = vi.fn(async () => runtime);
    const backing = Uint8Array.from([9, 37, 80, 68, 70, 45, 49, 46, 55, 9]);
    print.mockResolvedValueOnce(
      pdfResult(new Uint8Array(backing.buffer, 1, backing.byteLength - 2)),
    );
    const signal = new AbortController().signal;
    const feature = featureWith(cwd, { createRuntime, loader });

    await expect(
      feature.print({
        destination: "reports/book.pdf",
        scope: { kind: "worktree", worktreeId: "wt-1" },
        signal,
        unitId: "book-1",
      }),
    ).resolves.toEqual({
      location: join(cwd, "reports", "book.pdf"),
      ok: true,
      pageCount: 2,
      unitId: "book-1",
      unitType: "sheet",
    });
    expect(loader.loadUnit).toHaveBeenCalledWith({
      scope: { kind: "worktree", worktreeId: "wt-1" },
      unitId: "book-1",
    });
    expect(createRuntime).toHaveBeenCalledWith({
      env: { PUPPETEER_CACHE_DIR: "/browser-cache" },
      license: "license-value",
      renderPageRoot: "/render-runtime",
      signal,
    });
    expect(print).toHaveBeenCalledWith({ ...source, signal });
    expect(close).toHaveBeenCalledOnce();
    expect(await readFile(join(cwd, "reports", "book.pdf"))).toEqual(
      Buffer.from("%PDF-1.7"),
    );
    expect((await stat(join(cwd, "reports", "book.pdf"))).mode & 0o777).toBe(0o600);
    expect(await readdir(join(cwd, "reports"))).toEqual(["book.pdf"]);
  });

  it("rejects invalid, existing, and Base output without replacing user files", async () => {
    const cwd = await temporaryDirectory();
    const existing = join(cwd, "existing.pdf");
    await writeFile(existing, "keep");
    const feature = featureWith(cwd);
    print.mockResolvedValue(pdfResult(Uint8Array.from([1, 2, 3])));

    await expect(
      feature.print({ destination: "book.txt", scope: { kind: "trunk" }, unitId: "book-1" }),
    ).rejects.toMatchObject({ code: "workspace-print-pdf-output-invalid" });
    await expect(
      feature.print({ destination: "existing.pdf", scope: { kind: "trunk" }, unitId: "book-1" }),
    ).rejects.toMatchObject({ code: "workspace-print-pdf-output-exists" });
    expect(await readFile(existing, "utf8")).toBe("keep");

    const base = featureWith(cwd, {
      loader: { loadUnit: vi.fn(async () => ({ unitData: { id: "base-1" }, unitType: "base" }) as never) },
    });
    await expect(
      base.print({ destination: "base.pdf", scope: { kind: "trunk" }, unitId: "base-1" }),
    ).rejects.toMatchObject({ code: "workspace-print-pdf-type-unsupported" });
  });

  it("closes the runtime when printing fails", async () => {
    const cwd = await temporaryDirectory();
    const failure = new Error("print failed");
    print.mockRejectedValueOnce(failure);
    const close = vi.fn(async () => undefined);
    const feature = featureWith(cwd, {
      createRuntime: vi.fn(async () => ({ close }) as unknown as UniverPrintPdfRuntime),
    });

    await expect(
      feature.print({ destination: "book.pdf", scope: { kind: "trunk" }, unitId: "book-1" }),
    ).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });
});

function featureWith(
  cwd: string,
  overrides: Partial<ConstructorParameters<typeof WorkspacePrintPdfFeature>[0]> = {},
): WorkspacePrintPdfFeature {
  return new WorkspacePrintPdfFeature({
    cwd,
    env: { PUPPETEER_CACHE_DIR: "/browser-cache" },
    license: "license-value",
    loader: { loadUnit: vi.fn(async () => sheetSource()) },
    renderPageRoot: "/render-runtime",
    createRuntime: vi.fn(async () => ({ close: vi.fn() }) as unknown as UniverPrintPdfRuntime),
    ...overrides,
  });
}

function sheetSource(): UniverRenderUnit {
  return {
    unitData: { id: "book-1", name: "Book", sheetOrder: [], sheets: {} },
    unitType: "sheet",
  } as never;
}

function pdfResult(bytes: Uint8Array): UnitPdfPrintResult {
  return {
    bytes,
    mediaType: "application/pdf",
    name: "Book.pdf",
    pageCount: 2,
    unitId: "book-1",
    unitType: "sheet",
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "workspace-print-pdf-"));
  temporaryDirectories.push(directory);
  return directory;
}
