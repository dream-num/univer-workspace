import { afterEach, describe, expect, it, vi } from "vitest";
import { loadComparison } from "../src/client/api/comparison-api.ts";

afterEach(() => vi.unstubAllGlobals());
const labels = { base: "Base", result: "Draft" };
function payload(extra: Record<string, unknown> = {}) {
  return { result: { schemaVersion: 1, unit: { unitId: "u" } },
    left: { revision: 1, unitData: { id: "u" } },
    right: { revision: 2, unitData: { id: "u" } }, ...extra };
}
function reply(body: unknown) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
describe("historical comparison transport", () => {
  it("requests an explicit Base and preserves both pinned revisions", async () => {
    const fetch = reply(payload({ baseMode: "base", view: "draft" }));
    const signal = new AbortController().signal;
    const result = await loadComparison("wt/a", "u", "draft", labels, signal);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("wt%2Fa/units/u/comparison?baseMode=base&view=draft"), { signal });
    expect(result.left).toMatchObject({ label: "Base", revision: 1 });
    expect(result.right).toMatchObject({ label: "Draft", revision: 2 });
  });
  it("rejects an old server returning current trunk instead of Base", async () => {
    reply(payload());
    await expect(loadComparison("wt", "u", "draft", labels, new AbortController().signal)).rejects.toThrow("does not support");
  });
  it("accepts the original empty-Base response for a Worktree-local creation", async () => {
    reply(payload({ left: { unitData: null } }));
    expect((await loadComparison("wt", "u", "draft", labels, new AbortController().signal)).left.unitData).toBeNull();
  });
  it("never substitutes draft for a requested merge result", async () => {
    reply(payload({ baseMode: "base", view: "draft" }));
    await expect(loadComparison("wt", "u", "merged", labels, new AbortController().signal)).rejects.toThrow("does not support");
  });
  it("rejects a response for another Unit", async () => {
    reply(payload({ baseMode: "base", view: "draft", result: { schemaVersion: 1, unit: { unitId: "other" } } }));
    await expect(loadComparison("wt", "u", "draft", labels, new AbortController().signal)).rejects.toThrow();
  });
});
