import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../shared/i18n";
import { PartialMergeResults } from "./partial-merge-results";

function render(units: Parameters<typeof PartialMergeResults>[0]["units"]) {
  vi.stubGlobal("navigator", { languages: ["en-US"], language: "en-US" });
  return renderToStaticMarkup(createElement(LanguageProvider, null,
    createElement(PartialMergeResults, { units })));
}
afterEach(() => vi.unstubAllGlobals());

describe("partial Worktree merge presentation", () => {
  it("names merged and uncommitted units and distinguishes pending publication", () => {
    const html = render([
      { unitId: "one", name: "Existing Doc", source: "trunk", mergeResult: "merged", activationState: "notApplicable" },
      { unitId: "two", name: "Remaining Sheet", source: "trunk", mergeResult: "conflict", activationState: "notApplicable" },
      { unitId: "three", name: "New Sheet", source: "worktree", mergeResult: "merged", activationState: "pending" },
    ] as Parameters<typeof PartialMergeResults>[0]["units"]);
    expect(html).toContain("Existing Doc: Merge result: Merged");
    expect(html).toContain("Remaining Sheet: Merge result: Conflict");
    expect(html).toContain("New Sheet: Merge result: Merged");
    expect(html).toContain("New document publication: Waiting for publication");
    expect(html).toContain("does not roll back content already merged");
  });
  it("does not present a normal untouched draft as a partial merge", () => {
    const html = render([
      { unitId: "one", name: "Doc", source: "trunk", mergeResult: "pending", activationState: "notApplicable" },
      { unitId: "two", name: "Sheet", source: "trunk", mergeResult: "pending", activationState: "notApplicable" },
    ] as Parameters<typeof PartialMergeResults>[0]["units"]);
    expect(html).toBe("");
  });
  it("shows a merged new document whose publication is still pending", () => {
    const html = render([
      { unitId: "one", name: "Existing Doc", source: "trunk", mergeResult: "merged", activationState: "notApplicable" },
      { unitId: "two", name: "New Sheet", source: "worktree", mergeResult: "merged", activationState: "pending" },
    ] as Parameters<typeof PartialMergeResults>[0]["units"]);
    expect(html).toContain("New document publication: Waiting for publication");
    expect(html).toContain("Existing Doc: Merge result: Merged");
  });
});
