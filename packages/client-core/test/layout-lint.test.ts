import type { UnitLayoutLintInput, UnitLayoutLintReport } from "@univer-cli/unit-layout-lint";
import type { UniverRenderUnit, UniverSlideLayoutRuntime } from "@univer-cli/univer-render-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { lint, openLint } = vi.hoisted(() => ({ lint: vi.fn(), openLint: vi.fn() }));

vi.mock("@univer-cli/unit-layout-lint", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@univer-cli/unit-layout-lint")>()),
  createUnitLayoutLint: (options: unknown) => {
    openLint(options);
    return { lint };
  },
}));

import { WorkspaceUnitLayoutLintFeature } from "../src/layout-lint.js";

beforeEach(() => {
  lint.mockReset();
  openLint.mockReset();
});

describe("Workspace Slide and Board layout lint", () => {
  it.each(["sheet", "doc", "base"] as const)(
    "rejects %s before creating a browser runtime",
    async (unitType) => {
      const createRuntime = vi.fn();
      const feature = featureWith({
        createRuntime,
        loader: { loadUnit: async () => ({ unitData: { id: "unit-1" }, unitType }) as never },
      });
      await expect(
        feature.loadUnit({ scope: { kind: "worktree", worktreeId: "wt-1" }, unitId: "unit-1" }),
      ).rejects.toMatchObject({
        code: "workspace-unit-layout-lint-unit-type-unsupported",
        message: `Layout lint requires a Slide or Board Unit; unit-1 is ${unitType}.`,
      });
      expect(createRuntime).not.toHaveBeenCalled();
    },
  );

  it("maps exact Slide data and formula references", async () => {
    const unitData = { id: "deck-1", slideOrder: ["cover"], slides: {} };
    const formulaReferenceUnits = [{ unitData: { id: "sheet-1" }, unitType: "sheet" }];
    const feature = featureWith({
      loader: {
        loadUnit: async () => ({ formulaReferenceUnits, unitData, unitType: "slide" }) as never,
      },
    });
    await expect(
      feature.loadUnit({ scope: { kind: "worktree", worktreeId: "wt-1" }, unitId: "deck-1" }),
    ).resolves.toEqual({ formulaReferenceUnits, unitData, unitType: "slide" });
  });

  it("maps exact Board data and retains formula reference Units without mutation", async () => {
    const unitData = { id: "board-1", pages: {}, pageOrder: [] };
    const formulaReferenceUnits = [{ unitData: { id: "sheet-1" }, unitType: "sheet" }];
    const embeddedUnits = [{ unitData: { id: "child-1" }, unitType: "board" }];
    const source = { formulaReferenceUnits, embeddedUnits, unitData, unitType: "board" } as const;
    const feature = featureWith({ loader: { loadUnit: async () => source as never } });

    const result = await feature.loadUnit({
      scope: { kind: "worktree", worktreeId: "wt-1" },
      unitId: "board-1",
    });

    expect(result).toEqual(source);
    expect(result.unitData).toBe(unitData);
    expect(result.formulaReferenceUnits).toBe(formulaReferenceUnits);
    expect(result.unitType === "board" && result.embeddedUnits).toBe(embeddedUnits);
  });

  it("runs Board model checks without constructing a browser runtime", async () => {
    const createRuntime = vi.fn();
    const modelRuntime = { captureBoardModelLayout: vi.fn() };
    const feature = featureWith({ createRuntime, createModelRuntime: () => modelRuntime });
    const input = {
      unitType: "board",
      unitData: { id: "board-1" },
      mode: "model",
    } as UnitLayoutLintInput;
    const report = { kind: "unit-layout-lint", unitType: "board", unitId: "board-1", findings: [] };
    lint.mockResolvedValueOnce(report);

    await expect(feature.lint().lint(input)).resolves.toBe(report);

    expect(createRuntime).not.toHaveBeenCalled();
    expect(openLint).toHaveBeenCalledWith({ modelRuntime });
    expect(lint).toHaveBeenCalledWith(input);
  });

  it("passes Board rendered diagnostics and incomplete coverage through unchanged", async () => {
    const close = vi.fn(async () => undefined);
    const runtime = { close, captureBoardLayout: vi.fn() };
    const modelRuntime = { captureBoardModelLayout: vi.fn() };
    const feature = featureWith({
      createRuntime: async () => runtime,
      createModelRuntime: () => modelRuntime,
    });
    const input = {
      unitType: "board",
      unitData: { id: "board-1" },
      mode: "both",
      includeLabelPlan: true,
    } as UnitLayoutLintInput;
    const report = {
      unitType: "board",
      findings: [
        { rule: "connector-through-element", connectorIds: ["edge-1"], source: "rendered" },
      ],
      status: "incomplete",
      analyses: [{ pageId: "page-1", labelPlan: { status: "ready", patches: [] } }],
      coverage: { complete: false, incomplete: [{ reason: "unresolved-route" }] },
    };
    lint.mockResolvedValueOnce(report);

    await expect(feature.lint().lint(input)).resolves.toBe(report);

    expect(openLint).toHaveBeenCalledWith({ runtime, modelRuntime });
    expect(lint).toHaveBeenCalledWith(input);
    expect(close).toHaveBeenCalledOnce();
  });

  it("passes exact runtime/lint inputs and awaits close before success", async () => {
    const result = lintResult();
    lint.mockResolvedValueOnce(result);
    let resolveClose!: () => void;
    const close = vi.fn(async () => await new Promise<void>((resolve) => (resolveClose = resolve)));
    const createRuntime = vi.fn(
      async () => ({ close }) as unknown as UniverSlideLayoutRuntime & { close(): Promise<void> },
    );
    const env = { PUPPETEER_EXECUTABLE_PATH: "/browser" };
    const signal = new AbortController().signal;
    const feature = featureWith({ createRuntime, env });
    const input = {
      formulaReferenceUnits: [{ unitData: { id: "sheet-1" }, unitType: "sheet" }],
      pages: [1],
      signal,
      unitData: { id: "deck-1" },
      unitType: "slide",
    } as unknown as UnitLayoutLintInput;
    let settled = false;
    const operation = feature
      .lint()
      .lint(input)
      .finally(() => (settled = true));
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    resolveClose();

    await expect(operation).resolves.toBe(result);
    expect(createRuntime).toHaveBeenCalledWith({
      env,
      license: "license-value",
      renderPageRoot: "/render-runtime",
      signal,
    });
    expect(lint).toHaveBeenCalledWith(input);
  });

  it.each([
    ["failure", new Error("lint failed")],
    ["abort", Object.assign(new Error("aborted"), { name: "AbortError" })],
  ])("closes before rejecting on %s", async (_, failure) => {
    lint.mockRejectedValueOnce(failure);
    const close = vi.fn(async () => undefined);
    const createRuntime = vi.fn(
      async () => ({ close }) as unknown as UniverSlideLayoutRuntime & { close(): Promise<void> },
    );
    const feature = featureWith({ createRuntime });
    await expect(
      feature.lint().lint({
        signal: AbortSignal.abort(),
        unitData: { id: "deck-1" },
        unitType: "slide",
      } as UnitLayoutLintInput),
    ).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not fabricate close when runtime construction fails", async () => {
    const failure = new Error("browser failed");
    const feature = featureWith({
      createRuntime: async () => {
        throw failure;
      },
    });
    await expect(
      feature.lint().lint({ unitData: { id: "deck-1" }, unitType: "slide" } as UnitLayoutLintInput),
    ).rejects.toBe(failure);
    expect(lint).not.toHaveBeenCalled();
  });
});

function featureWith(
  overrides: Partial<ConstructorParameters<typeof WorkspaceUnitLayoutLintFeature>[0]> = {},
): WorkspaceUnitLayoutLintFeature {
  return new WorkspaceUnitLayoutLintFeature({
    env: {},
    license: "license-value",
    loader: { loadUnit: async () => ({ unitData: {}, unitType: "slide" }) as UniverRenderUnit },
    renderPageRoot: "/render-runtime",
    ...overrides,
  });
}

function lintResult(): UnitLayoutLintReport {
  return {
    coverage: {
      pages: [{ page: 1, pageId: "cover" }],
      rules: ["text-off-page", "text-escapes-container", "text-overlaps-text"],
    },
    findings: [],
    kind: "unit-layout-lint",
    unitId: "deck-1",
    unitType: "slide",
  };
}
