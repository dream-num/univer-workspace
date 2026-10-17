import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../web/src/features/editor/collaboration-editor", () => ({
  createCollaborationEditor: () => null,
}));

afterEach(() => vi.unstubAllGlobals());

describe("embedded product preset integration", () => {
  it("reuses an existing RPC worker without allocating a second Worker", async () => {
    vi.stubGlobal("Path2D", class {});
    const WorkerMock = vi.fn(function () {});
    vi.stubGlobal("Worker", WorkerMock);
    const { createBaseComparisonPresets } =
      await import("../../web/src/features/editor/units/base/base-editor");
    const { UniverRPCMainThreadPlugin } = await import("@univerjs/rpc");
    const onWorker = vi.fn();
    const presets = createBaseComparisonPresets({} as HTMLElement, {
      collaboration: true,
      worker: false,
      onWorker,
    });
    expect(WorkerMock).not.toHaveBeenCalled();
    expect(onWorker).not.toHaveBeenCalled();
    expect(
      presets
        .flatMap((p) => p.plugins)
        .some((p) => (Array.isArray(p) ? p[0] : p) === UniverRPCMainThreadPlugin),
    ).toBe(false);
    createBaseComparisonPresets({} as HTMLElement, { collaboration: true, onWorker });
    expect(WorkerMock).toHaveBeenCalledOnce();
    expect(onWorker).toHaveBeenCalledOnce();
  }, 20_000);

  it("keeps the host's remote image and attachment service registrations", async () => {
    vi.stubGlobal("Path2D", class {});
    const { createBaseComparisonPresets } =
      await import("../../web/src/features/editor/units/base/base-editor");
    const { UniverBasesUIPlugin } = await import("@univerjs-pro/bases-ui");
    const { UniverDrawingPlugin } = await import("@univerjs/drawing");
    const { IAttachmentIoService } = await import("@univerjs-pro/collaboration-client");
    const { IImageIoService, Injector, mergeOverrideWithDependencies, registerDependencies } =
      await import("@univerjs/core");
    const presets = createBaseComparisonPresets({} as HTMLElement, {
      collaboration: true,
      worker: false,
    });
    for (const [plugin, identifier] of [
      [UniverBasesUIPlugin, IAttachmentIoService],
      [UniverDrawingPlugin, IImageIoService],
    ] as const) {
      const tuple = presets
        .flatMap((p) => p.plugins)
        .find((p) => Array.isArray(p) && p[0] === plugin);
      if (!Array.isArray(tuple)) throw new Error("Expected configured product plugin");
      const injector = new Injector();
      const remote = { remote: true };
      injector.add([identifier, { useValue: remote }]);
      registerDependencies(
        injector,
        mergeOverrideWithDependencies(
          [[identifier, { useValue: { local: true } }]],
          tuple[1].override,
        ),
      );
      expect(injector.get(identifier)).toBe(remote);
      injector.dispose();
    }
  }, 20_000);
});
