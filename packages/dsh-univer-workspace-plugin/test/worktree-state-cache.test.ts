import { afterEach, expect, it, vi } from "vitest";
import { getFileState, invalidateFileState } from "../src/client/api/univer-api.ts";

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
