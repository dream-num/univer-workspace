import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DependentOn,
  LocaleType,
  LogLevel,
  Plugin,
  Univer,
  UniverInstanceType,
} from "@univerjs/core";
import { createWorkspaceReferencedUnitProviderRegistration } from "@univerjs/univer-workspace-reference-provider";

const factories = vi.hoisted(() => ({
  sheet: vi.fn(() => [{ plugins: [] }]),
  doc: vi.fn(() => [{ plugins: [] }]),
  slide: vi.fn(() => [{ plugins: [] }]),
  base: vi.fn(),
  board: vi.fn(() => [{ plugins: [] }]),
}));
vi.mock("../../web/src/features/editor/units/sheet/sheet-comparison-presets", () => ({
  createSheetEditorPresets: factories.sheet,
  sheetEditorLocales: { "en-US": {}, "zh-CN": {} },
}));
vi.mock("../../web/src/features/editor/units/doc/doc-editor", () => ({
  createDocComparisonPresets: factories.doc,
  docEditorLocales: { "en-US": {}, "zh-CN": {} },
}));
vi.mock("../../web/src/features/editor/units/slide/slide-editor", () => ({
  createSlideComparisonPresets: factories.slide,
  slideEditorLocales: { "en-US": {}, "zh-CN": {} },
}));
vi.mock("../../web/src/features/editor/units/base/base-editor", () => ({
  createBaseComparisonPresets: factories.base,
  baseEditorLocales: { "en-US": {}, "zh-CN": {} },
}));
vi.mock("../../web/src/features/editor/units/board/board-editor", () => ({
  createBoardComparisonPresets: factories.board,
  boardEditorLocales: { "en-US": {}, "zh-CN": {} },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("on-demand embed products", () => {
  it("loads no product until requested, coalesces requests and handles all five child types", async () => {
    const { createEmbedProductRuntime } =
      await import("../../web/src/features/editor/embed-product-runtime");
    vi.stubGlobal("window", { location: { origin: "http://localhost" } });
    factories.base.mockReturnValue([{ plugins: [] }]);
    const univer = new Univer();
    const runtime = createEmbedProductRuntime({
      univer,
      container: {} as HTMLElement,
      license: "",
      plugins: [],
    });
    try {
      for (const factory of Object.values(factories)) expect(factory).not.toHaveBeenCalled();
      const first = runtime.ensure(UniverInstanceType.UNIVER_BASE);
      expect(runtime.ensure(UniverInstanceType.UNIVER_BASE)).toBe(first);
      await first;
      expect(factories.base).toHaveBeenCalledOnce();
      expect(factories.sheet).not.toHaveBeenCalled();
      for (const type of [
        UniverInstanceType.UNIVER_SHEET,
        UniverInstanceType.UNIVER_DOC,
        UniverInstanceType.UNIVER_SLIDE,
        UniverInstanceType.UNIVER_BOARD,
      ])
        await runtime.ensure(type);
      for (const factory of Object.values(factories)) expect(factory).toHaveBeenCalledOnce();
    } finally {
      runtime.dispose();
      univer.dispose();
    }
  });

  it("prepares the Base model before the real SDK creates a referenced Base", async () => {
    vi.stubGlobal("Path2D", class {});
    const { UniverEmbedPlugin } = await import("@univerjs-pro/embed");
    const { UniverBasesPlugin } = await import("@univerjs-pro/bases");
    const { createEmbedProductRuntime } =
      await import("../../web/src/features/editor/embed-product-runtime");
    factories.base.mockReturnValue([{ plugins: [UniverBasesPlugin] }]);
    const unprepared = new Univer({ logLevel: LogLevel.SILENT });
    unprepared.registerPlugin(UniverEmbedPlugin);
    try {
      expect(() =>
        unprepared.createUnit(UniverInstanceType.UNIVER_BASE, { id: "unprepared" }),
      ).toThrow("No constructor registered for unit type 5");
    } finally {
      unprepared.dispose();
    }
    const univer = new Univer({ locale: LocaleType.EN_US, logLevel: LogLevel.SILENT });
    univer.registerPlugin(UniverEmbedPlugin);
    const runtime = createEmbedProductRuntime({
      univer,
      container: {} as HTMLElement,
      license: "",
      plugins: [UniverEmbedPlugin],
    });
    const snapshot = { id: "referenced-base", name: "Events", tables: {}, tableOrder: [] };
    const loader = {
      loadBase: async () => univer.createUnit(UniverInstanceType.UNIVER_BASE, snapshot),
    };
    const registration = createWorkspaceReferencedUnitProviderRegistration({
      hostContext: { view: { kind: "trunk" } },
      prepareUnit: runtime.ensure,
      resolveSnapshotService: () => loader as never,
    });
    try {
      await expect(
        registration.provider.ensureUnit({
          unitType: UniverInstanceType.UNIVER_BASE,
          ref: { file: { kind: "self" }, unit: { type: "base", selector: snapshot.id } },
        }),
      ).resolves.toEqual({ unitId: snapshot.id, unitType: UniverInstanceType.UNIVER_BASE });
    } finally {
      runtime.dispose();
      univer.dispose();
    }
  }, 20_000);

  it("reuses transitive SDK plugins while propagating real initialization errors", async () => {
    const { createEmbedProductRuntime } =
      await import("../../web/src/features/editor/embed-product-runtime");
    class Dependency extends Plugin {
      static pluginName = "embed-test-dependency";
      static type = UniverInstanceType.UNIVER_UNKNOWN;
    }
    class Root extends Plugin {
      static pluginName = "embed-test-root";
      static type = UniverInstanceType.UNIVER_UNKNOWN;
    }
    DependentOn(Dependency)(Root);
    class Broken extends Plugin {
      static pluginName = "embed-test-broken";
      static type = UniverInstanceType.UNIVER_UNKNOWN;
      constructor() {
        super();
        throw new Error("service unavailable");
      }
    }
    factories.base.mockReturnValue([{ plugins: [Dependency] }]);
    factories.doc.mockReturnValueOnce([{ plugins: [Broken] }]);
    const univer = new Univer();
    univer.registerPlugin(Root);
    const runtime = createEmbedProductRuntime({
      univer,
      container: {} as HTMLElement,
      license: "",
      plugins: [Root],
    });
    try {
      await expect(runtime.ensure(UniverInstanceType.UNIVER_BASE)).resolves.toBeUndefined();
      await expect(runtime.ensure(UniverInstanceType.UNIVER_DOC)).rejects.toThrow(
        "service unavailable",
      );
    } finally {
      runtime.dispose();
      univer.dispose();
    }
  });

  it("retries a failed preparation without blocking another product", async () => {
    const { createEmbedProductRuntime } =
      await import("../../web/src/features/editor/embed-product-runtime");
    factories.base
      .mockImplementationOnce(() => {
        throw new Error("chunk unavailable");
      })
      .mockReturnValue([{ plugins: [] }]);
    const univer = new Univer();
    const runtime = createEmbedProductRuntime({
      univer,
      container: {} as HTMLElement,
      license: "",
      plugins: [],
    });
    try {
      await expect(runtime.ensure(UniverInstanceType.UNIVER_BASE)).rejects.toThrow(
        "chunk unavailable",
      );
      await runtime.ensure(UniverInstanceType.UNIVER_DOC);
      await runtime.ensure(UniverInstanceType.UNIVER_BASE);
      expect(factories.base).toHaveBeenCalledTimes(2);
    } finally {
      runtime.dispose();
      univer.dispose();
    }
  });

  it("terminates externally-created embed workers when the editor is disposed", async () => {
    const { createEmbedProductRuntime } =
      await import("../../web/src/features/editor/embed-product-runtime");
    const worker = { terminate: vi.fn() };
    factories.base.mockImplementationOnce((_container, options) => {
      options.onWorker(worker);
      return [{ plugins: [] }];
    });
    const univer = new Univer();
    const runtime = createEmbedProductRuntime({
      univer,
      container: {} as HTMLElement,
      license: "",
      plugins: [],
    });
    await runtime.ensure(UniverInstanceType.UNIVER_BASE);
    expect(worker.terminate).not.toHaveBeenCalled();
    univer.dispose();
    runtime.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("does not accumulate workers or report success after a partial SDK initialization failure", async () => {
    const { createEmbedProductRuntime } =
      await import("../../web/src/features/editor/embed-product-runtime");
    const worker = { terminate: vi.fn() };
    class Broken extends Plugin {
      static pluginName = "embed-worker-failure";
      static type = UniverInstanceType.UNIVER_UNKNOWN;
      constructor() {
        super();
        throw new Error("SDK initialization failed");
      }
    }
    factories.base.mockImplementationOnce((_container, options) => {
      options.onWorker(worker);
      return [{ plugins: [Broken] }];
    });
    const univer = new Univer();
    const runtime = createEmbedProductRuntime({
      univer,
      container: {} as HTMLElement,
      license: "",
      plugins: [],
    });
    const failed = runtime.ensure(UniverInstanceType.UNIVER_BASE);
    await expect(failed).rejects.toThrow("SDK initialization failed");
    expect(runtime.ensure(UniverInstanceType.UNIVER_BASE)).toBe(failed);
    await expect(runtime.ensure(UniverInstanceType.UNIVER_BASE)).rejects.toThrow(
      "SDK initialization failed",
    );
    expect(factories.base).toHaveBeenCalledOnce();
    runtime.dispose();
    univer.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("does not register into an editor disposed during a pending product import", async () => {
    const { createEmbedProductRuntime } =
      await import("../../web/src/features/editor/embed-product-runtime");
    factories.base.mockReturnValue([{ plugins: [] }]);
    const univer = new Univer();
    const runtime = createEmbedProductRuntime({
      univer,
      container: {} as HTMLElement,
      license: "",
      plugins: [],
    });
    const pending = runtime.ensure(UniverInstanceType.UNIVER_BASE);
    univer.dispose();
    await expect(pending).rejects.toThrow("disposed");
    expect(factories.base).not.toHaveBeenCalled();
    await expect(runtime.ensure(UniverInstanceType.UNIVER_BASE)).rejects.toThrow("disposed");
  });
});
