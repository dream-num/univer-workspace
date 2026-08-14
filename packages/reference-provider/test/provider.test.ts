import type { ILogContext } from "@univerjs-pro/collaboration";
import type { IResourceRef } from "@univerjs-pro/embed";
import { UniverInstanceType } from "@univerjs/core";
import {
  WORKSPACE_REFERENCED_UNIT_PROVIDER_ID,
  WORKSPACE_REFERENCED_UNIT_PROVIDER_PRIORITY,
  createWorkspaceReferencedUnitProviderRegistration,
  readWorkspaceReferenceSourceScope,
  type WorkspaceSnapshotLoader,
} from "../src/index.js";
import { describe, expect, it, vi } from "vitest";

const ref: IResourceRef = {
  file: { kind: "self" },
  unit: { selector: "source-unit", type: "sheet" },
};

describe("Workspace Referenced Unit Provider", () => {
  it("registers one higher-priority self provider for the five supported Unit types", () => {
    const registration = createWorkspaceReferencedUnitProviderRegistration({
      hostContext: { view: { kind: "trunk" } },
      resolveSnapshotService: () => loader().service,
    });
    expect(registration).toMatchObject({
      registrationId: WORKSPACE_REFERENCED_UNIT_PROVIDER_ID,
      priority: WORKSPACE_REFERENCED_UNIT_PROVIDER_PRIORITY,
      match: {
        fileKinds: ["self"],
        unitTypes: ["sheet", "doc", "slide", "base", "board"],
      },
    });
  });

  it("lazily resolves SnapshotService and loads a mapped Source without collaboration lifecycle", async () => {
    const fake = loader();
    const resolveSnapshotService = vi.fn(() => fake.service);
    const registration = createWorkspaceReferencedUnitProviderRegistration({
      hostContext: {
        view: { kind: "worktree", worktreeId: "worktree-1" },
        mappedUnitIds: ["host-unit", "source-unit"],
      },
      resolveSnapshotService,
    });

    expect(resolveSnapshotService).not.toHaveBeenCalled();
    await expect(
      registration.provider.ensureUnit({
        createOptions: { makeCurrent: false },
        ref,
        unitType: UniverInstanceType.UNIVER_SHEET,
      }),
    ).resolves.toEqual({
      unitId: "source-unit",
      unitType: UniverInstanceType.UNIVER_SHEET,
    });
    expect(resolveSnapshotService).toHaveBeenCalledOnce();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.method).toBe("loadSheet");
    expect(
      readWorkspaceReferenceSourceScope(fake.calls[0]!.context, "source-unit"),
    ).toEqual({
      kind: "worktree",
      unitId: "source-unit",
      worktreeId: "worktree-1",
    });
  });

  it("rejects invalid mapping inputs before resolving SnapshotService", async () => {
    const resolveSnapshotService = vi.fn(() => loader().service);
    const registration = createWorkspaceReferencedUnitProviderRegistration({
      hostContext: { view: { kind: "trunk" } },
      resolveSnapshotService,
    });
    await expect(
      registration.provider.ensureUnit({
        createOptions: {},
        ref: { ...ref, unit: { ...ref.unit, type: "doc" } },
        unitType: UniverInstanceType.UNIVER_SHEET,
      }),
    ).rejects.toMatchObject({
      code: "unit-type-mismatch",
    });
    expect(resolveSnapshotService).not.toHaveBeenCalled();
  });

  it("rejects a materialized Unit with a different identity", async () => {
    const fake = loader("other-unit");
    const registration = createWorkspaceReferencedUnitProviderRegistration({
      hostContext: { view: { kind: "trunk" } },
      resolveSnapshotService: () => fake.service,
    });
    await expect(
      registration.provider.ensureUnit({
        createOptions: {},
        ref,
        unitType: UniverInstanceType.UNIVER_SHEET,
      }),
    ).rejects.toMatchObject({
      code: "loaded-identity-mismatch",
    });
  });

  it("rejects a materialized Unit with a different type", async () => {
    const fake = loader(
      "source-unit",
      UniverInstanceType.UNIVER_DOC,
    );
    const registration = createWorkspaceReferencedUnitProviderRegistration({
      hostContext: { view: { kind: "trunk" } },
      resolveSnapshotService: () => fake.service,
    });
    await expect(
      registration.provider.ensureUnit({
        createOptions: {},
        ref,
        unitType: UniverInstanceType.UNIVER_SHEET,
      }),
    ).rejects.toMatchObject({
      code: "loaded-type-mismatch",
    });
  });

  it("uses the matching SnapshotService loader for every supported Unit type", async () => {
    const scenarios = [
      ["sheet", UniverInstanceType.UNIVER_SHEET, "loadSheet"],
      ["doc", UniverInstanceType.UNIVER_DOC, "loadDoc"],
      ["slide", UniverInstanceType.UNIVER_SLIDE, "loadSlide"],
      ["base", UniverInstanceType.UNIVER_BASE, "loadBase"],
      ["board", UniverInstanceType.UNIVER_BOARD, "loadBoard"],
    ] as const;

    for (const [resourceType, unitType, method] of scenarios) {
      const fake = loader();
      const registration = createWorkspaceReferencedUnitProviderRegistration({
        hostContext: { view: { kind: "trunk" } },
        resolveSnapshotService: () => fake.service,
      });
      await registration.provider.ensureUnit({
        createOptions: {},
        ref: {
          file: { kind: "self" },
          unit: { selector: "source-unit", type: resourceType },
        },
        unitType,
      });
      expect(fake.calls).toEqual([
        expect.objectContaining({ method }),
      ]);
    }
  });

  it("does not call the loader when the request is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = loader();
    const registration = createWorkspaceReferencedUnitProviderRegistration({
      hostContext: { view: { kind: "trunk" } },
      resolveSnapshotService: () => fake.service,
    });
    await expect(
      registration.provider.ensureUnit({
        createOptions: {},
        ref,
        signal: controller.signal,
        unitType: UniverInstanceType.UNIVER_SHEET,
      }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(fake.calls).toHaveLength(0);
  });

  it("lets an in-flight shared Source load finish after its caller aborts", async () => {
    let releaseLoad!: () => void;
    const waitForRelease = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const controller = new AbortController();
    const fake = loader("source-unit", undefined, waitForRelease);
    const registration = createWorkspaceReferencedUnitProviderRegistration({
      hostContext: { view: { kind: "trunk" } },
      resolveSnapshotService: () => fake.service,
    });

    const load = registration.provider.ensureUnit({
      createOptions: {},
      ref,
      signal: controller.signal,
      unitType: UniverInstanceType.UNIVER_SHEET,
    });
    expect(fake.calls).toHaveLength(1);

    controller.abort();
    releaseLoad();

    await expect(load).resolves.toEqual({
      unitId: "source-unit",
      unitType: UniverInstanceType.UNIVER_SHEET,
    });
  });
});

function loader(
  loadedUnitId = "source-unit",
  forcedUnitType?: UniverInstanceType,
  waitForLoad?: Promise<void>,
): {
  readonly calls: Array<{ readonly context: ILogContext; readonly method: string }>;
  readonly service: WorkspaceSnapshotLoader;
} {
  const calls: Array<{ readonly context: ILogContext; readonly method: string }> = [];
  const load = async (
    method: string,
    unitType: UniverInstanceType,
    context?: ILogContext,
  ) => {
    calls.push({ context: context ?? {}, method });
    await waitForLoad;
    return {
      type: forcedUnitType ?? unitType,
      getUnitId: () => loadedUnitId,
    };
  };
  return {
    calls,
    service: {
      loadSheet: async (_unitId, _revision, context) =>
        await load("loadSheet", UniverInstanceType.UNIVER_SHEET, context),
      loadDoc: async (_unitId, _revision, context) =>
        await load("loadDoc", UniverInstanceType.UNIVER_DOC, context),
      loadSlide: async (_unitId, _revision, context) =>
        await load("loadSlide", UniverInstanceType.UNIVER_SLIDE, context),
      loadBase: async (_unitId, _revision, context) =>
        await load("loadBase", UniverInstanceType.UNIVER_BASE, context),
      loadBoard: async (_unitId, _revision, context) =>
        await load("loadBoard", UniverInstanceType.UNIVER_BOARD, context),
    },
  };
}
