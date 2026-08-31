import { UniverInstanceType } from "@univerjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backend: vi.fn((options: unknown) => ({ options })),
  factory: vi.fn(),
  headless: vi.fn(),
  host: vi.fn(),
  load: vi.fn(),
}));

vi.mock("@univer-cli/univer-collaboration-runtime", () => ({
  createCollaborationServerAdapter: mocks.backend,
  createUniverCollaborationRuntimeFactory: mocks.factory,
}));
vi.mock("@univer-cli/headless-univer", () => ({
  createStandardHeadlessUniverFactory: mocks.headless,
}));
vi.mock("../src/reference-host.js", () => ({
  loadWorkspaceReferenceHostContext: mocks.host,
}));

import { workspaceContentRuntimeWorker } from "../src/content-worker.js";

describe("Workspace content runtime worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.host.mockResolvedValue({ hostRevision: 7, membership: new Map() });
    mocks.load.mockResolvedValue({ unitId: "unit-1" });
    mocks.factory.mockReturnValue({ load: mocks.load });
    mocks.headless.mockReturnValue(async () => ({ dispose: vi.fn() }));
  });

  it.each([
    [
      "trunk",
      { kind: "trunk" },
      "https://workspace.test/universer-api/comb",
      "https://workspace.test/universer-api/snapshot",
    ],
    [
      "worktree",
      { kind: "worktree", worktreeId: "wt / one" },
      "https://workspace.test/universer-api/worktrees/wt%20%2F%20one/comb",
      "https://workspace.test/universer-api/worktrees/wt%20%2F%20one/snapshot",
    ],
  ])("composes exact %s Collaboration endpoints", async (_label, scope, comb, snapshot) => {
    await workspaceContentRuntimeWorker.createRuntime(init(scope));

    expect(mocks.backend).toHaveBeenCalledWith(
      expect.objectContaining({
        collabSubmitChangesetUrl: comb,
        collabWebSocketUrl: `${comb}/connect`,
        snapshotServerUrl: snapshot,
        wsSessionTicketUrl: "https://workspace.test/universer-api/user/session-ticket",
      }),
    );
    expect(mocks.load).toHaveBeenCalledWith("unit-1", UniverInstanceType.UNIVER_SHEET);
    const backendOptions = mocks.backend.mock.calls[0]![0] as Record<string, unknown>;
    expect(JSON.stringify(backendOptions)).not.toContain("secret-cookie");
    expect(JSON.stringify(backendOptions)).not.toContain("secret-license");
  });

  it("supplies the license and Unit provider without replacing SDK data providers", async () => {
    await workspaceContentRuntimeWorker.createRuntime(init({ kind: "trunk" }));
    const factoryOptions = mocks.factory.mock.calls[0]![0] as {
      readonly createUniver: (context: unknown) => Promise<unknown>;
    };
    const resolveSnapshotService = vi.fn();

    await factoryOptions.createUniver({
      resolveSnapshotService,
      unitId: "unit-1",
      unitType: UniverInstanceType.UNIVER_SHEET,
    });

    expect(mocks.headless).toHaveBeenCalledWith(
      expect.objectContaining({
        embedPluginConfig: { resourceRefUnitProviderRegistrations: expect.any(Array) },
        license: "secret-license",
      }),
    );
    const headlessOptions = mocks.headless.mock.calls[0]![0] as {
      readonly embedPluginConfig: Record<string, unknown>;
    };
    expect(headlessOptions.embedPluginConfig).not.toHaveProperty(
      "resourceRefDataProviderRegistrations",
    );
  });

  it("rejects malformed private init before host loading without disclosing secrets", async () => {
    const error = await Promise.resolve(
      workspaceContentRuntimeWorker.createRuntime({
        credential: "secret-cookie",
        license: "secret-license",
      }),
    )
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: "WORKSPACE_RUNTIME_INIT_INVALID" });
    expect(`${String(error)}${JSON.stringify(error)}`).not.toContain("secret-cookie");
    expect(`${String(error)}${JSON.stringify(error)}`).not.toContain("secret-license");
    expect(mocks.host).not.toHaveBeenCalled();
    expect(mocks.backend).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("preserves the missing SnapshotService resolver failure", async () => {
    await workspaceContentRuntimeWorker.createRuntime(init({ kind: "trunk" }));
    const factoryOptions = mocks.factory.mock.calls[0]![0] as {
      readonly createUniver: (context: unknown) => Promise<unknown>;
    };

    await expect(
      factoryOptions.createUniver({
        unitId: "unit-1",
        unitType: UniverInstanceType.UNIVER_SHEET,
      }),
    ).rejects.toMatchObject({ code: "workspace-reference-runtime-invalid" });
  });
});

function init(scope: unknown): unknown {
  return {
    credential: "secret-cookie",
    license: "secret-license",
    target: {
      origin: "https://workspace.test",
      revision: 7,
      scope,
      unitId: "unit-1",
      unitType: "sheet",
    },
  };
}
