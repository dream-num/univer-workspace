import { afterEach, describe, expect, it, vi } from "vitest";
import { IUniverInstanceService, UniverInstanceType, type Univer } from "@univerjs/core";
import { IRenderManagerService } from "@univerjs/engine-render";
import { UnitRegistry } from "../render-runtime/src/units.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function createHarness(options: { renderReadyAfterMs?: number } = {}) {
  const created: Array<{ type: UniverInstanceType; id: unknown }> = [];
  const disposed: string[] = [];
  const renders = new Map<string, object>();
  const instanceService = {
    focusUnit: vi.fn(),
    setCurrentUnitForType: vi.fn(),
    disposeUnit: (unitId: string) => disposed.push(unitId),
  };
  const univer = {
    createUnit: (type: UniverInstanceType, data: { readonly id?: unknown }) => {
      created.push({ type, id: data.id });
      if (typeof data.id === "string") {
        const register = () => renders.set(data.id as string, {});
        if (options.renderReadyAfterMs === undefined) register();
        else setTimeout(register, options.renderReadyAfterMs);
      }
    },
    __getInjector: () => ({
      get: (token: unknown) => {
        if (token === IUniverInstanceService) return instanceService;
        if (token === IRenderManagerService) {
          return { getRenderUnitById: (unitId: string) => renders.get(unitId) };
        }
        throw new Error("unexpected dependency");
      },
    }),
  } as unknown as Univer;
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 1),
  );
  vi.stubGlobal("document", {
    querySelectorAll: () => [{ clientWidth: 800, clientHeight: 600 }],
  });
  return { registry: new UnitRegistry(univer), created, disposed };
}

describe("UnitRegistry dependency closure", () => {
  it("waits for the target render registration after a generic canvas is ready", async () => {
    const harness = createHarness({ renderReadyAfterMs: 400 });
    let resolved = false;
    const loading = harness.registry
      .load({ unitKey: "doc::r1", unitType: "doc", unitData: { id: "doc-1" } })
      .then((value) => {
        resolved = true;
        return value;
      });
    await vi.advanceTimersByTimeAsync(200);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(loading).resolves.toEqual({ unitKey: "doc::r1", loaded: true });
  });

  it("creates embedded Units before the Host and disposes them with the session", async () => {
    const harness = createHarness();
    const loading = harness.registry.load({
      unitKey: "slide::r1::embed::r2",
      unitType: "slide",
      unitData: { id: "slide-host" },
      embeddedUnits: [
        { unitId: "embedded-sheet", unitType: "sheet", unitData: { id: "embedded-sheet" } },
      ],
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(loading).resolves.toEqual({ unitKey: "slide::r1::embed::r2", loaded: true });
    expect(harness.created).toEqual([
      { type: UniverInstanceType.UNIVER_SHEET, id: "embedded-sheet" },
      { type: UniverInstanceType.UNIVER_SLIDE, id: "slide-host" },
    ]);
    harness.registry.disposeUnit("slide::r1::embed::r2");
    expect(harness.disposed).toEqual(["slide-host", "embedded-sheet"]);
  });
});
