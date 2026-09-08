import { describe, expect, it } from "vitest";
import { selectViewportUnits } from "../src/client/components/worktree-review/viewport-policy.ts";

describe("review viewport policy", () => {
  const item = (unitId: string, distance: number) => ({ unitId, distance });
  it("preloads half a screen and waits for more distant Units", () => {
    expect([...selectViewportUnits([item("visible", 0), item("near", 390), item("far", 410)], new Set(), 800, 3)])
      .toEqual(["visible", "near"]);
  });
  it("retains mounted Units for a screen without preloading that entire zone", () => {
    expect([...selectViewportUnits([item("visible", 0), item("retained", 700), item("unloaded", 700), item("far", 801)], new Set(["retained", "far"]), 800, 3)])
      .toEqual(["visible", "retained", "far"]);
  });
  it("protects visible Units over the normal cache budget", () => {
    const visible = [item("a", 0), item("b", 0), item("c", 0), item("d", 0)];
    expect([...selectViewportUnits(visible, new Set(), 800, 3)]).toEqual(["a", "b", "c", "d"]);
  });
  it("budgets speculative loads and prefers the nearest", () => {
    expect([...selectViewportUnits([item("a", 0), item("farther", 300), item("nearest", 100), item("next", 200)], new Set(), 800, 3)])
      .toEqual(["a", "nearest", "next"]);
  });
  it("retains all five visited documents across several screens", () => {
    const previous = new Set(["a", "b", "c", "d", "e"]);
    for (const active of previous) {
      const items = [...previous].map((id) => item(id, id === active ? 0 : 3000));
      expect(selectViewportUnits(items, previous, 800, 6)).toEqual(previous);
    }
  });
  it("evicts a distant cached document only when the cache is full", () => {
    const items = [item("visible", 0), item("preload", 200), item("nearby", 700),
      item("a", 1000), item("b", 1500), item("c", 2000), item("farthest", 3000)];
    const previous = new Set(["visible", "nearby", "a", "b", "c", "farthest"]);
    expect([...selectViewportUnits(items, previous, 800, 6)])
      .toEqual(["visible", "nearby", "preload", "a", "b", "c"]);
  });

});
