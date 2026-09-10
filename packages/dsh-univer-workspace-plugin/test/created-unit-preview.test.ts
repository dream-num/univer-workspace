import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmCreatedUnitMergePreview } from "../src/client/viewer/proxy.ts";
const mocks = vi.hoisted(() => ({ evaluate: vi.fn(), get: vi.fn() }));
vi.mock("@univerjs-pro/collaboration-worktree-client", () => ({
  WorktreeClient: class { evaluateUnitMerge = mocks.evaluate; getWorktree = mocks.get; },
}));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
function setup(overrides = {}) {
  vi.stubGlobal("window", { location: { origin: "https://agent.test" } });
  mocks.evaluate.mockResolvedValue({ worktreeID: "wt", unitID: "u", status: "not-applicable", reason: "worktree-created-unit" });
  mocks.get.mockResolvedValue({ worktreeID: "wt", status: "ready", units: [
    { unitID: "u", source: "worktree", draftHeadRevision: 3, readyDraftHeadRevision: 3 },
  ], ...overrides });
}
const confirm = (revision = 3) => confirmCreatedUnitMergePreview("wt", "u", revision, new AbortController().signal);
describe("new Unit merge preview compatibility", () => {
  it("accepts only the evaluated creation's exact ready snapshot", async () => {
    setup(); expect(await confirm()).toBe(true); expect(await confirm(2)).toBe(false);
  });
  it.each(["draft", "discarded", "merged"])("rejects a %s Worktree", async status => {
    setup({ status }); expect(await confirm()).toBe(false);
  });
  it.each(["preview", "conflict", "not-behind"])("does not reuse draft for evaluation %s", async status => {
    setup(); mocks.evaluate.mockResolvedValue({ worktreeID: "wt", unitID: "u", status });
    expect(await confirm()).toBe(false); expect(mocks.get).not.toHaveBeenCalled();
  });
  it("rejects removed Units and changed draft heads", async () => {
    for (const override of [{ removed: true }, { source: "trunk" }, { draftHeadRevision: 4 }]) {
      setup({ units: [{ unitID: "u", source: "worktree", draftHeadRevision: 3, readyDraftHeadRevision: 3, ...override }] });
      expect(await confirm()).toBe(false);
    }
  });
});
