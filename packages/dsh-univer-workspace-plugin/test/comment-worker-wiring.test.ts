import { expect, it, vi } from "vitest";
import { UniverInstanceType } from "@univerjs/core";
const mocks = vi.hoisted(() => ({ createUniver: vi.fn(), registerPlugin: vi.fn() }));
vi.mock("@univer-cli/headless-univer", () => ({
  createStandardHeadlessUniverFactory: () => async () => ({
    registerPlugin: mocks.registerPlugin,
    dispose() {},
  }),
}));
vi.mock("@univer-cli/univer-collaboration-runtime", () => ({
  createCollaborationServerAdapter: () => ({}),
  createUniverCollaborationRuntimeFactory: (options: { createUniver: unknown }) => {
    mocks.createUniver.mockReturnValue(options.createUniver);
    return { load: async () => ({}) };
  },
}));
import worker from "../src/runtime/worker.ts";
it.each([
  UniverInstanceType.UNIVER_SHEET,
  UniverInstanceType.UNIVER_DOC,
  UniverInstanceType.UNIVER_SLIDE,
  UniverInstanceType.UNIVER_BASE,
  UniverInstanceType.UNIVER_BOARD,
])("installs comment compatibility before DSH loads type %s", async (unitType) => {
  mocks.registerPlugin.mockClear();
  await worker.createRuntime({
    origin: "https://workspace.test",
    sessionToken: "test",
    revision: 1,
    license: "",
    unitId: "test",
    unitType: "sheet",
    scope: { kind: "trunk" },
  });
  await mocks.createUniver()({ unitId: "test", unitType, resolveSnapshotService: () => undefined });
  expect(mocks.registerPlugin).toHaveBeenCalledTimes(
    unitType === UniverInstanceType.UNIVER_SHEET ? 0 : 1,
  );
});
