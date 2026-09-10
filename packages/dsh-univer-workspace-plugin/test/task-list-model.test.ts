import { describe, expect, it } from "vitest";
import { clampTaskPosition, countWorktreeChanges } from "../src/client/components/task-list-model.ts";

describe("compact task list", () => {
  it("counts each document once using its latest change kind", () => {
    expect(countWorktreeChanges([
      { unitId: "a", kind: "added" }, { unitId: "b", kind: "modified" },
      { unitId: "c", kind: "deleted" }, { unitId: "a", kind: "added" },
      { unitId: "d", kind: "unchanged" }, { unitId: "b", kind: "deleted" },
    ])).toEqual({ added: 1, modified: 0, deleted: 2 });
  });
  it("permits positions outside the conversation but within the viewport", () => {
    expect(clampTaskPosition({ x: 1400, y: 20 }, { width: 340, height: 200 }, { width: 1800, height: 1080 }))
      .toEqual({ x: 1400, y: 20 });
  });
  it("keeps the card reachable when dragged beyond any viewport edge", () => {
    expect(clampTaskPosition({ x: -200, y: 2000 }, { width: 340, height: 200 }, { width: 800, height: 600 }))
      .toEqual({ x: 0, y: 400 });
    expect(clampTaskPosition({ x: 2000, y: -10 }, { width: 340, height: 200 }, { width: 800, height: 600 }))
      .toEqual({ x: 460, y: 0 });
  });
  it("handles a viewport smaller than the old card dimensions", () => {
    expect(clampTaskPosition({ x: 400, y: 500 }, { width: 340, height: 200 }, { width: 200, height: 100 }))
      .toEqual({ x: 0, y: 0 });
  });
});
