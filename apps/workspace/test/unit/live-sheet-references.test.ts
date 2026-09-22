import { describe, expect, it, vi } from "vitest";
import { UniverInstanceType } from "@univerjs/core";
import type { IEmbedResourceRefUnitProviderRegistration } from "@univerjs-pro/embed";
import { withLiveSheetReferences } from "../../web/src/features/editor/live-sheet-references";

const sourceId = "sheet-source";
function registration(type = UniverInstanceType.UNIVER_SHEET): IEmbedResourceRefUnitProviderRegistration {
  return {
    registrationId: "test", match: {},
    provider: { ensureUnit: vi.fn(async () => ({ unitId: sourceId, unitType: type })) },
  };
}
const input = {
  ref: { file: { kind: "self" as const }, unit: { type: "sheet" as const, selector: sourceId } },
  unitType: UniverInstanceType.UNIVER_SHEET, createOptions: {},
};

describe("live Sheet references", () => {
  it("connects a trunk Sheet once, after materialization", async () => {
    const base = registration();
    const connect = vi.fn(async () => { expect(base.provider.ensureUnit).toHaveBeenCalled(); });
    const live = withLiveSheetReferences(base, { view: { kind: "trunk" } }, connect);
    await Promise.all([live.provider.ensureUnit(input), live.provider.ensureUnit(input)]);
    expect(connect).toHaveBeenCalledExactlyOnceWith(sourceId);
  });

  it("subscribes only to sources mapped into the same Worktree", async () => {
    for (const mappedUnitIds of [[], [sourceId]]) {
      const connect = vi.fn(async () => {});
      const live = withLiveSheetReferences(registration(), {
        view: { kind: "worktree", worktreeId: "task" }, mappedUnitIds,
      }, connect);
      await live.provider.ensureUnit(input);
      expect(connect).toHaveBeenCalledTimes(mappedUnitIds.length);
    }
  });

  it("never makes a merge-preview source live", async () => {
    const connect = vi.fn(async () => {});
    const live = withLiveSheetReferences(registration(), {
      view: { kind: "mergePreview", worktreeId: "task" }, mappedUnitIds: [sourceId],
    }, connect);
    await live.provider.ensureUnit(input);
    expect(connect).not.toHaveBeenCalled();
  });

  it("leaves non-Sheet references unchanged", async () => {
    const connect = vi.fn(async () => {});
    const live = withLiveSheetReferences(registration(UniverInstanceType.UNIVER_DOC), { view: { kind: "trunk" } }, connect);
    await live.provider.ensureUnit(input);
    expect(connect).not.toHaveBeenCalled();
  });

  it("propagates connection failure and permits a retry", async () => {
    const connect = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const live = withLiveSheetReferences(registration(), { view: { kind: "trunk" } }, connect);
    await expect(live.provider.ensureUnit(input)).rejects.toThrow("offline");
    await live.provider.ensureUnit(input);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("does not connect after the source load was cancelled", async () => {
    const abort = new AbortController();
    abort.abort();
    const connect = vi.fn(async () => {});
    const live = withLiveSheetReferences(registration(), { view: { kind: "trunk" } }, connect);
    await expect(live.provider.ensureUnit({ ...input, signal: abort.signal })).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });
});
