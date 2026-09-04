import { describe, expect, it } from "vitest";
import { claimExclusiveViewer } from "../src/client/components/viewer-expansion.ts";
import { isViewerUnitTypeSupported, SUPPORTED_VIEWER_UNIT_TYPES } from "../src/client/viewer-types.ts";

describe("exclusive viewer ownership", () => {
  it("advertises every Unit composition mounted by the embedded bundle", () => {
    expect(SUPPORTED_VIEWER_UNIT_TYPES).toEqual(["sheet", "doc", "slide", "base", "board"]);
    for (const unitType of SUPPORTED_VIEWER_UNIT_TYPES) {
      expect(isViewerUnitTypeSupported(unitType)).toBe(true);
    }
  });

  it("collapses the previous owner for the same Unit and preserves the new owner", () => {
    const firstToken = {};
    const secondToken = {};
    let firstCollapsed = 0;
    let secondCollapsed = 0;

    const releaseFirst = claimExclusiveViewer("unit-1", firstToken, () => { firstCollapsed += 1; });
    const releaseSecond = claimExclusiveViewer("unit-1", secondToken, () => { secondCollapsed += 1; });

    expect(firstCollapsed).toBe(1);
    expect(secondCollapsed).toBe(0);

    releaseFirst();
    expect(secondCollapsed).toBe(0);

    releaseSecond();
    const releaseThird = claimExclusiveViewer("unit-1", {}, () => { secondCollapsed += 1; });
    expect(secondCollapsed).toBe(0);
    releaseThird();
  });

  it("does not collapse a different Unit", () => {
    let collapsed = 0;
    const releaseA = claimExclusiveViewer("unit-a", {}, () => { collapsed += 1; });
    const releaseB = claimExclusiveViewer("unit-b", {}, () => { collapsed += 1; });

    expect(collapsed).toBe(0);
    releaseA();
    releaseB();
  });
});
