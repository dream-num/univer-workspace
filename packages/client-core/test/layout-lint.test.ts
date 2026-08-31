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
    const signal = new AbortController().signal;
    const loadUnit = vi.fn(
      async () => ({ formulaReferenceUnits, unitData, unitType: "slide" }) as never,
    );
    const feature = featureWith({
      loader: { loadUnit },
    });
    await expect(
      feature.loadUnit({
        scope: { kind: "worktree", worktreeId: "wt-1" },
        signal,
        unitId: "deck-1",
      }),
    ).resolves.toEqual({ formulaReferenceUnits, unitData, unitType: "slide" });
    expect(loadUnit).toHaveBeenCalledWith({
      scope: { kind: "worktree", worktreeId: "wt-1" },
      signal,
      unitId: "deck-1",
    });
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

  it("closes before rejecting on lint failure", async () => {
    const failure = new Error("lint failed");
    lint.mockRejectedValueOnce(failure);
    const close = vi.fn(async () => undefined);
    const createRuntime = vi.fn(
      async () => ({ close } as unknown as UniverSlideLayoutRuntime & { close(): Promise<void> }),
    );
    const feature = featureWith({ createRuntime });
    await expect(
      feature.lint().lint({
        signal: new AbortController().signal,
        unitData: { id: "deck-1" },
        unitType: "slide",
      } as UnitLayoutLintInput),
    ).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not create a browser for a pre-aborted signal", async () => {
    const createRuntime = vi.fn();
    const feature = featureWith({ createRuntime });
    const reason = new Error("cancel-before-browser");
    const controller = new AbortController();
    controller.abort(reason);

    await expect(
      feature.lint().lint({
        signal: controller.signal,
        unitData: { id: "deck-1" },
        unitType: "slide",
      } as UnitLayoutLintInput),
    ).rejects.toBe(reason);
    expect(createRuntime).not.toHaveBeenCalled();
    expect(lint).not.toHaveBeenCalled();
  });

  it("closes a browser returned after cancellation and starts no lint", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel-during-browser-construction");
    const close = vi.fn(async () => {
      throw new Error("close-secret");
    });
    const feature = featureWith({
      createRuntime: async () => {
        controller.abort(reason);
        return ({ close }) as unknown as UniverSlideLayoutRuntime & { close(): Promise<void> };
      },
    });

    await expect(
      feature.lint().lint({
        signal: controller.signal,
        unitData: { id: "deck-1" },
        unitType: "slide",
      } as UnitLayoutLintInput),
    ).rejects.toBe(reason);
    expect(lint).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("prefers an abort that races browser construction rejection", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel-during-browser-construction");
    const feature = featureWith({
      createRuntime: async () => {
        controller.abort(reason);
        throw new Error("browser-dependency-secret");
      },
    });

    await expect(
      feature.lint().lint({
        signal: controller.signal,
        unitData: { id: "deck-1" },
        unitType: "slide",
      } as UnitLayoutLintInput),
    ).rejects.toBe(reason);
    expect(lint).not.toHaveBeenCalled();
  });

  it("preserves an abort that races lint rejection and close rejection", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel-during-lint-rejection");
    lint.mockImplementationOnce(async () => {
      controller.abort(reason);
      throw new Error("lint-dependency-secret");
    });
    const close = vi.fn(async () => {
      throw new Error("close-secret");
    });
    const feature = featureWith({
      createRuntime: async () =>
        ({ close }) as unknown as UniverSlideLayoutRuntime & { close(): Promise<void> },
    });

    await expect(
      feature.lint().lint({
        signal: controller.signal,
        unitData: { id: "deck-1" },
        unitType: "slide",
      } as UnitLayoutLintInput),
    ).rejects.toBe(reason);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([new Error("lint-primary"), undefined, null])(
    "preserves lint failure %# when close also rejects",
    async (failure) => {
      lint.mockRejectedValueOnce(failure);
      const close = vi.fn(async () => {
        throw new Error("close-secret");
      });
      const feature = featureWith({
        createRuntime: async () =>
          ({ close }) as unknown as UniverSlideLayoutRuntime & { close(): Promise<void> },
      });

      await expect(
        feature.lint().lint({ unitData: { id: "deck-1" }, unitType: "slide" } as UnitLayoutLintInput),
      ).rejects.toBe(failure);
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it("observes cancellation that becomes visible while close settles", async () => {
    lint.mockResolvedValueOnce(lintResult());
    const controller = new AbortController();
    const reason = new Error("cancel-during-close");
    const close = vi.fn(async () => controller.abort(reason));
    const feature = featureWith({
      createRuntime: async () =>
        ({ close }) as unknown as UniverSlideLayoutRuntime & { close(): Promise<void> },
    });

    await expect(
      feature.lint().lint({
        signal: controller.signal,
        unitData: { id: "deck-1" },
        unitType: "slide",
      } as UnitLayoutLintInput),
    ).rejects.toBe(reason);
    expect(close).toHaveBeenCalledOnce();
  });

  it("awaits browser close when cancellation becomes visible during lint", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel-during-lint");
    lint.mockImplementationOnce(async () => {
      controller.abort(reason);
      return lintResult();
    });
    let resolveClose!: () => void;
    const close = vi.fn(async () => await new Promise<void>((resolve) => (resolveClose = resolve)));
    const feature = featureWith({
      createRuntime: async () =>
        ({ close }) as unknown as UniverSlideLayoutRuntime & { close(): Promise<void> },
    });
    let settled = false;

    const operation = feature.lint().lint({
      signal: controller.signal,
      unitData: { id: "deck-1" },
      unitType: "slide",
    } as UnitLayoutLintInput).finally(() => (settled = true));
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    resolveClose();

    await expect(operation).rejects.toBe(reason);
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
