import type { UnitLayoutLintInput, UnitLayoutLintReport } from "@univer-cli/unit-layout-lint";
import type {
  UniverRenderUnit,
  UniverSlideLayoutRuntime,
} from "@univer-cli/univer-render-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lint = vi.hoisted(() => vi.fn());

vi.mock("@univer-cli/unit-layout-lint", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@univer-cli/unit-layout-lint")>()),
  createUnitLayoutLint: () => ({ lint }),
}));

import { WorkspaceUnitLayoutLintFeature } from "../src/layout-lint.js";

beforeEach(() => lint.mockReset());

describe("Workspace Slide layout lint", () => {
  it.each(["sheet", "doc", "base", "board"] as const)(
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
        message: `Slide layout lint requires a Slide Unit; unit-1 is ${unitType}.`,
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

  it("passes exact runtime/lint inputs and awaits close before success", async () => {
    const result = lintResult();
    lint.mockResolvedValueOnce(result);
    let resolveClose!: () => void;
    const close = vi.fn(async () => await new Promise<void>((resolve) => (resolveClose = resolve)));
    const createRuntime = vi.fn(
      async () => ({ close } as unknown as UniverSlideLayoutRuntime & { close(): Promise<void> }),
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
    const operation = feature.lint().lint(input).finally(() => (settled = true));
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
      async () => ({ close } as unknown as UniverSlideLayoutRuntime & { close(): Promise<void> }),
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
