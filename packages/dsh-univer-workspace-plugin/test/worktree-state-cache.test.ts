import { afterEach, expect, it, vi } from "vitest";
import { getFileState, invalidateFileState, subscribeFileStateInvalidation } from "../src/client/api/univer-api.ts";

afterEach(() => vi.unstubAllGlobals());

it("does not reuse or cache a read started before a removal mutation", async () => {
  let finishOld!: (response: Response) => void;
  let finishNew!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishNew = resolve;
        }),
    );
  vi.stubGlobal("fetch", fetch);
  const key = "wt:removal-cache-race";
  const stale = getFileState(key);
  await Promise.resolve();
  invalidateFileState(key);
  const fresh = getFileState(key);
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(2);
  const state = { worktrees: [{ status: "draft", units: [{ kind: "deleted" }] }] };
  finishNew(Response.json(state));
  expect(await fresh).toEqual(state);
  finishOld(Response.json({ worktrees: [{ status: "draft", units: [{ kind: "modified" }] }] }));
  expect(await stale).toEqual(state);
  expect(await getFileState(key)).toEqual(state);
  expect(fetch).toHaveBeenCalledTimes(2);
  invalidateFileState(key);
});

it("refreshes a cached empty Worktree after a Unit creation notification", async () => {
  const key = "wt:created-unit";
  const empty = { worktrees: [{ unitCount: 0, units: [] }] };
  const populated = { worktrees: [{ unitCount: 1, units: [{ unitId: "created", kind: "added" }] }] };
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(empty)).mockResolvedValueOnce(Response.json(populated));
  vi.stubGlobal("fetch", fetch);
  expect(await getFileState(key)).toEqual(empty);
  let refreshed: Promise<unknown> | undefined;
  const unsubscribe = subscribeFileStateInvalidation((changed) => {
    if (changed === key) refreshed = getFileState(key);
  });
  invalidateFileState(key);
  expect(await refreshed).toEqual(populated);
  unsubscribe();
  invalidateFileState(key);
  expect(fetch).toHaveBeenCalledTimes(2);
});
