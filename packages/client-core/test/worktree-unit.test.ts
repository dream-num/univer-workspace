import { describe, expect, it, vi } from "vitest";
import {
  parseUnit,
  parseWorktree,
  stableKey,
  WorkspaceHttp,
  WorkspaceOpenFeature,
  WorkspaceUnitFeature,
  WorkspaceWorktreeFeature,
  type WorkspaceWorktreeState,
} from "../src/index.js";

describe("Workspace Worktree model and workflow", () => {
  it("strictly parses Worktrees and Units and binds an expected Worktree identity", () => {
    expect(parseWorktree(rawWorktree("wt-1"), "wt-1")).toMatchObject({
      id: "wt-1",
      state: "draft",
    });
    expect(() => parseWorktree(rawWorktree("wt-other"), "wt-1")).toThrowError(
      expect.objectContaining({ code: "workspace-result-mismatch" }),
    );
    expect(() => parseWorktree({ ...rawWorktree("wt-1"), state: "unknown" })).toThrowError(
      expect.objectContaining({ code: "workspace-invalid-response" }),
    );
    expect(() => parseWorktree({ ...rawWorktree("wt-1"), teamSpace: { id: "" } })).toThrowError(
      expect.objectContaining({ code: "workspace-invalid-response" }),
    );
    expect(() => parseUnit({ ...rawUnit(), fileId: "legacy" }, "wt-1")).toThrowError(
      expect.objectContaining({ code: "workspace-invalid-response" }),
    );
    expect(() =>
      parseUnit({ ...rawUnit({ source: "worktree" }), target: null }, "wt-1"),
    ).toThrowError(expect.objectContaining({ code: "workspace-invalid-response" }));
  });

  it.each([
    [{ view: "active" } as const, "/api/worktrees?scope=active"],
    [
      { scope: "user", view: "processed" } as const,
      "/api/worktrees?scope=processed&kind=user",
    ],
    [
      { scope: "space", spaceId: "space / 1", view: "active" } as const,
      "/api/worktrees?scope=active&kind=team&teamSpaceId=space+%2F+1",
    ],
  ])("lists Worktrees with the exact query for %j", async (input, expectedPath) => {
    let path = "";
    const feature = worktrees(async (input, init) => {
      const request = new Request(input, init);
      path = new URL(request.url).pathname + new URL(request.url).search;
      return Response.json({ items: [rawWorktree("wt-1")] });
    });
    await expect(feature.list(input)).resolves.toHaveLength(1);
    expect(path).toBe(expectedPath);
  });

  it("rejects invalid Worktree lists as a whole", async () => {
    const missing = worktrees(async () => Response.json({}));
    await expect(missing.list({ view: "active" })).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });
    const invalidItem = worktrees(async () =>
      Response.json({ items: [rawWorktree("wt-1"), { id: "wt-2", state: "draft" }] }),
    );
    await expect(invalidItem.list({ view: "active" })).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });
  });

  it("creates with one stable identity and preserves exact user and Team request bodies", async () => {
    const requests: Request[] = [];
    let attempt = 0;
    const feature = worktrees(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      attempt += 1;
      if (attempt < 3) throw new Error("response lost");
      return Response.json(rawWorktree("wt-created"));
    });
    await expect(
      feature.create({
        idempotencyKey: "stable-key",
        name: "Draft",
        scope: { kind: "space", spaceId: "space-1" },
      }),
    ).resolves.toMatchObject({ id: "wt-created" });
    expect(requests.map((request) => request.headers.get("idempotency-key"))).toEqual([
      "stable-key",
      "stable-key",
      "stable-key",
    ]);
    for (const request of requests) {
      await expect(request.json()).resolves.toEqual({
        kind: "team",
        name: "Draft",
        summary: null,
        teamSpaceId: "space-1",
        visibility: "private",
      });
    }
  });

  it("gets and updates with bound identity and does not replay an unknown update", async () => {
    const paths: string[] = [];
    const feature = worktrees(async (input, init) => {
      const request = new Request(input, init);
      paths.push(`${request.method} ${new URL(request.url).pathname}`);
      if (request.method === "PATCH") throw new Error("response lost");
      return Response.json({ worktree: rawWorktree("wt-1") });
    });
    await expect(feature.get("wt-1")).resolves.toMatchObject({ id: "wt-1" });
    await expect(feature.update("wt-1", { name: "Renamed" })).rejects.toMatchObject({
      code: "workspace-result-unknown",
    });
    expect(paths).toEqual(["GET /api/worktrees/wt-1", "PATCH /api/worktrees/wt-1"]);
  });

  it.each([
    ["ready", "draft", "ready", false],
    ["reopen", "ready", "draft", false],
    ["merge", "ready", "merged", true],
    ["discard", "draft", "discarded", true],
    ["discard", "ready", "discarded", true],
  ] as const)(
    "performs allowed %s transition from %s to %s",
    async (action, initial, expected, idempotent) => {
      const requests: Request[] = [];
      const feature = worktrees(async (input, init) => {
        const request = new Request(input, init);
        requests.push(request.clone());
        return request.method === "GET"
          ? Response.json({ worktree: rawWorktree("wt-1", initial) })
          : Response.json({ worktree: rawWorktree("wt-1", expected) });
      });
      await expect(feature.transition("wt-1", action)).resolves.toMatchObject({
        state: expected,
      });
      expect(requests.map((request) => request.method)).toEqual(["GET", "POST"]);
      expect(requests[1]!.headers.get("idempotency-key")).toBe(
        idempotent ? stableKey(action, "wt-1") : null,
      );
    },
  );

  it.each([
    ["ready", "ready"],
    ["ready", "merging"],
    ["ready", "merged"],
    ["ready", "discarded"],
    ["reopen", "draft"],
    ["reopen", "merging"],
    ["reopen", "merged"],
    ["reopen", "discarded"],
    ["merge", "draft"],
    ["merge", "merging"],
    ["merge", "merged"],
    ["merge", "discarded"],
    ["discard", "merging"],
    ["discard", "merged"],
    ["discard", "discarded"],
  ] as const)("rejects invalid %s transition from %s before POST", async (action, state) => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ worktree: rawWorktree("wt-1", state) }),
    );
    await expect(worktrees(fetcher).transition("wt-1", action)).rejects.toMatchObject({
      code: "workspace-lifecycle-invalid",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects lifecycle identity/state mismatches without read-back", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) =>
      (init?.method ?? "GET") === "GET"
        ? Response.json({ worktree: rawWorktree("wt-1", "ready") })
        : Response.json({ worktree: rawWorktree("wt-1", "ready") }),
    );
    await expect(worktrees(fetcher).transition("wt-1", "merge")).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    const wrongId = vi.fn<typeof fetch>(async (_input, init) =>
      (init?.method ?? "GET") === "GET"
        ? Response.json({ worktree: rawWorktree("wt-1", "ready") })
        : Response.json({ worktree: rawWorktree("wt-other", "merged") }),
    );
    await expect(worktrees(wrongId).transition("wt-1", "merge")).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
    expect(wrongId).toHaveBeenCalledTimes(2);
  });

  it("confirms one unknown lifecycle result by one read-back and otherwise stays unknown", async () => {
    let getCount = 0;
    let postCount = 0;
    const confirmed = worktrees(async (_input, init) => {
      if ((init?.method ?? "GET") === "POST") {
        postCount += 1;
        throw new Error("response lost");
      }
      getCount += 1;
      return Response.json({
        worktree: rawWorktree("wt-1", getCount === 1 ? "ready" : "merged"),
      });
    });
    await expect(confirmed.transition("wt-1", "merge")).resolves.toMatchObject({
      state: "merged",
    });
    expect({ getCount, postCount }).toEqual({ getCount: 2, postCount: 1 });

    getCount = 0;
    postCount = 0;
    const unconfirmed = worktrees(async (_input, init) => {
      if ((init?.method ?? "GET") === "POST") {
        postCount += 1;
        throw new Error("response lost");
      }
      getCount += 1;
      return Response.json({ worktree: rawWorktree("wt-1", "ready") });
    });
    await expect(unconfirmed.transition("wt-1", "merge")).rejects.toMatchObject({
      code: "workspace-result-unknown",
      detail: { actualState: "ready", expectedState: "merged", worktreeId: "wt-1" },
    });
    expect({ getCount, postCount }).toEqual({ getCount: 2, postCount: 1 });
  });

  it("keeps a wrong-identity read-back in result-unknown semantics", async () => {
    let getCount = 0;
    const feature = worktrees(async (_input, init) => {
      if ((init?.method ?? "GET") === "POST") throw new Error("response lost");
      getCount += 1;
      return Response.json({
        worktree: rawWorktree(getCount === 1 ? "wt-1" : "wt-other", "ready"),
      });
    });
    await expect(feature.transition("wt-1", "merge")).rejects.toMatchObject({
      code: "workspace-result-unknown",
      detail: { actualId: "wt-other", expectedState: "merged", worktreeId: "wt-1" },
    });
  });

  it("derives stable lifecycle identities without collisions", () => {
    expect(stableKey("merge", "wt-1")).toBe(stableKey("merge", "wt-1"));
    expect(stableKey("merge", "wt-1")).not.toBe(stableKey("discard", "wt-1"));
    expect(stableKey("merge", "wt-1")).not.toBe(stableKey("merge", "wt-2"));
  });
});

describe("Workspace Worktree Unit membership", () => {
  it("lists Units through the bound Worktree response", async () => {
    const feature = units(async () =>
      Response.json({ worktree: rawWorktree("wt-1", "draft", [rawUnit()]) }),
    );
    await expect(feature.list("wt-1")).resolves.toMatchObject([
      { unitId: "unit-1", worktreeId: "wt-1" },
    ]);
  });

  it("rejects a Unit list returned for another Worktree", async () => {
    const feature = units(async () =>
      Response.json({ worktree: rawWorktree("wt-other", "draft", [rawUnit()]) }),
    );
    await expect(feature.list("wt-1")).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
  });

  it("adds a trunk Resource with exact body and one stable retry identity", async () => {
    const requests: Request[] = [];
    const feature = units(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      if (requests.length === 1) throw new Error("response lost");
      return Response.json({ unit: rawUnit() });
    });
    await expect(feature.add("wt-1", "resource-1")).resolves.toMatchObject({
      resourceId: "resource-1",
      source: "trunk",
      target: null,
    });
    expect(requests.map((request) => request.headers.get("idempotency-key"))).toEqual([
      stableKey("add-unit", "wt-1", "resource-1"),
      stableKey("add-unit", "wt-1", "resource-1"),
    ]);
    for (const request of requests) {
      await expect(request.json()).resolves.toEqual({ resourceId: "resource-1", source: "trunk" });
    }
  });

  it.each([
    [{ resourceId: "resource-other" }, "resource"],
    [{ source: "worktree", target: { parentNodeId: null, spaceId: "space-1" } }, "source"],
    [{ target: { parentNodeId: null, spaceId: "space-1" } }, "target"],
  ])("rejects added Unit %s mismatch", async (override, _case) => {
    const feature = units(async () => Response.json({ unit: rawUnit(override) }));
    await expect(feature.add("wt-1", "resource-1")).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
  });

  it("creates a Worktree-local Unit with stable key/body and bounded public error detail", async () => {
    const sentinel = { secret: "large-private-initial-data" };
    const requests: Request[] = [];
    const created = units(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      if (requests.length === 1) throw new Error("response lost");
      return Response.json({
        unit: rawUnit({
          name: "Planning",
          source: "worktree",
          target: { parentNodeId: "node-parent", spaceId: "space-1" },
        }),
      });
    });
    await expect(
      created.create({
        idempotencyKey: "unit-key",
        initialData: sentinel,
        name: "Planning",
        parentNodeId: "node-parent",
        spaceId: "space-1",
        type: "sheet",
        worktreeId: "wt-1",
      }),
    ).resolves.toMatchObject({ name: "Planning", source: "worktree" });
    expect(requests.map((request) => request.headers.get("idempotency-key"))).toEqual([
      "unit-key",
      "unit-key",
    ]);
    for (const request of requests) {
      await expect(request.json()).resolves.toEqual({
        initialData: sentinel,
        name: "Planning",
        source: "worktree",
        targetParentNodeId: "node-parent",
        targetSpaceId: "space-1",
        unitType: "sheet",
      });
    }

    const failed = units(async () => {
      throw new Error("response lost");
    });
    const result = failed.create({
      initialData: sentinel,
      name: "Planning",
      spaceId: "space-1",
      type: "sheet",
      worktreeId: "wt-1",
    });
    await expect(result).rejects.toMatchObject({
      code: "workspace-result-unknown",
      detail: {
        request: expect.not.objectContaining({ initialData: expect.anything() }),
      },
    });
    await expect(result).rejects.not.toMatchObject({
      message: expect.stringContaining(sentinel.secret),
    });
  });

  it("generates one local Unit identity and reuses it across retries", async () => {
    const keys: (string | null)[] = [];
    const feature = units(async (_input, init) => {
      keys.push(new Headers(init?.headers).get("idempotency-key"));
      if (keys.length === 1) throw new Error("response lost");
      return Response.json({
        unit: rawUnit({
          name: "Planning",
          source: "worktree",
          target: { parentNodeId: null, spaceId: "space-1" },
        }),
      });
    });
    await feature.create({
      name: "Planning",
      spaceId: "space-1",
      type: "sheet",
      worktreeId: "wt-1",
    });
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/u);
    expect(keys[1]).toBe(keys[0]);
  });

  it.each([
    [{ source: "trunk" }, "source"],
    [{ unitType: "doc" }, "type"],
    [{ name: "Other" }, "name"],
    [{ target: { parentNodeId: null, spaceId: "space-other" } }, "Space"],
    [{ target: { parentNodeId: "node-other", spaceId: "space-1" } }, "parent"],
  ])("rejects local Unit %s mismatch", async (override, _case) => {
    const response = rawUnit({
      name: "Planning",
      source: "worktree",
      target: { parentNodeId: null, spaceId: "space-1" },
      ...override,
    });
    if (response.source === "trunk") response.target = null;
    const feature = units(async () => Response.json({ unit: response }));
    await expect(
      feature.create({
        name: "Planning",
        spaceId: "space-1",
        type: "sheet",
        worktreeId: "wt-1",
      }),
    ).rejects.toMatchObject({ code: "workspace-result-mismatch" });
  });
});

describe("Workspace review URL", () => {
  it.each(["relative", "http://[", "file:///tmp/viewer"])(
    "rejects invalid explicit viewer URL %s before providers",
    async (viewerBaseUrl) => {
      const authenticatedHttp = vi.fn();
      const configuredOrigin = vi.fn();
      const feature = new WorkspaceOpenFeature(authenticatedHttp, configuredOrigin);
      await expect(
        feature.createUrl({ viewerBaseUrl, worktreeId: "wt-1" }),
      ).rejects.toMatchObject({ code: "workspace-viewer-url-invalid" });
      expect(authenticatedHttp).not.toHaveBeenCalled();
      expect(configuredOrigin).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid default origin before HTTP", async () => {
    const authenticatedHttp = vi.fn();
    const configuredOrigin = vi.fn(async () => "relative");
    const feature = new WorkspaceOpenFeature(authenticatedHttp, configuredOrigin);
    await expect(feature.createUrl({ worktreeId: "wt-1" })).rejects.toMatchObject({
      code: "workspace-viewer-url-invalid",
    });
    expect(configuredOrigin).toHaveBeenCalledTimes(1);
    expect(authenticatedHttp).not.toHaveBeenCalled();
  });

  it("uses explicit override, selects one Unit, and builds the exact URL", async () => {
    const configuredOrigin = vi.fn(async () => "https://default.test");
    const feature = new WorkspaceOpenFeature(
      async () =>
        http(async () =>
          Response.json({ worktree: rawWorktree("wt-1", "draft", [rawUnit()]) }),
        ),
      configuredOrigin,
    );
    await expect(
      feature.createUrl({
        viewerBaseUrl: "https://viewer.test/old/path?old=1#hash",
        worktreeId: "wt-1",
      }),
    ).resolves.toEqual({
      openUrl: "https://viewer.test/worktrees?worktree=wt-1&unit=unit-1&view=agent",
      type: "sheet",
      unitId: "unit-1",
      worktreeId: "wt-1",
    });
    expect(configuredOrigin).not.toHaveBeenCalled();
  });

  it.each([0, 2])("requires an explicit Unit for a Worktree with %i Units", async (count) => {
    const source = [rawUnit(), { ...rawUnit(), unitId: "unit-2" }].slice(0, count);
    const feature = openFor(source);
    await expect(feature.createUrl({ worktreeId: "wt-1" })).rejects.toMatchObject({
      code: "workspace-open-unit-required",
      detail: { unitCount: count, worktreeId: "wt-1" },
    });
  });

  it("rejects a selected Unit that is absent", async () => {
    const feature = openFor([rawUnit()]);
    await expect(
      feature.createUrl({ unitId: "unit-other", worktreeId: "wt-1" }),
    ).rejects.toMatchObject({
      code: "workspace-unit-not-found",
      detail: { unitId: "unit-other", worktreeId: "wt-1" },
    });
  });

  it("rejects a returned Unit bound to another Worktree", async () => {
    const feature = openFor([{ ...rawUnit(), worktreeId: "wt-other" }]);
    await expect(feature.createUrl({ worktreeId: "wt-1" })).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
  });
});

describe("Workspace Worktree and Unit cancellation", () => {
  it("passes one signal through each read family", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.signal).toBe(controller.signal);
      if (new URL(String(input)).searchParams.has("scope")) return Response.json({ items: [] });
      return Response.json({ worktree: rawWorktree("wt-1", "draft", [rawUnit()]) });
    });
    const authenticatedHttp = vi.fn(async (signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      return http(fetcher);
    });
    const worktreeFeature = new WorkspaceWorktreeFeature(authenticatedHttp);
    const unitFeature = new WorkspaceUnitFeature(authenticatedHttp);
    const openFeature = new WorkspaceOpenFeature(
      authenticatedHttp,
      async () => "https://workspace.test",
    );

    await expect(worktreeFeature.list({ view: "active" }, controller.signal)).resolves.toHaveLength(0);
    await expect(worktreeFeature.get("wt-1", controller.signal)).resolves.toMatchObject({ id: "wt-1" });
    await expect(unitFeature.list("wt-1", controller.signal)).resolves.toHaveLength(1);
    await expect(openFeature.createUrl({ worktreeId: "wt-1" }, controller.signal)).resolves.toMatchObject({
      unitId: "unit-1",
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("does not dispatch mutation families when already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const fetcher = vi.fn<typeof fetch>();
    const worktreeFeature = worktrees(fetcher);
    const unitFeature = units(fetcher);

    await expect(worktreeFeature.create({ name: "Draft", scope: { kind: "user" } }, controller.signal)).rejects.toThrow("cancelled");
    await expect(worktreeFeature.update("wt-1", { name: "Renamed" }, controller.signal)).rejects.toThrow("cancelled");
    await expect(worktreeFeature.transition("wt-1", "ready", controller.signal)).rejects.toThrow("cancelled");
    await expect(unitFeature.add("wt-1", "resource-1", controller.signal)).rejects.toThrow("cancelled");
    await expect(unitFeature.create({ name: "Draft", spaceId: "space-1", type: "sheet", worktreeId: "wt-1" }, controller.signal)).rejects.toThrow("cancelled");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["worktree-create", "unit-add", "unit-create"] as const)(
    "stops stable-identity retry after an uncertain %s attempt",
    async (kind) => {
      const controller = new AbortController();
      const fetcher = vi.fn<typeof fetch>(async () => {
        controller.abort(new Error("cancelled"));
        throw new Error("response lost");
      });
      const result = kind === "worktree-create"
        ? worktrees(fetcher).create({ name: "Draft", scope: { kind: "user" } }, controller.signal)
        : kind === "unit-add"
          ? units(fetcher).add("wt-1", "resource-1", controller.signal)
          : units(fetcher).create({ name: "Draft", spaceId: "space-1", type: "sheet", worktreeId: "wt-1" }, controller.signal);

      await expect(result).rejects.toMatchObject({ code: "workspace-result-unknown" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("does not start lifecycle read-back after the transition aborts", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if ((init?.method ?? "GET") === "GET") {
        return Response.json({ worktree: rawWorktree("wt-1", "ready") });
      }
      controller.abort(new Error("cancelled"));
      throw new Error("response lost");
    });

    await expect(worktrees(fetcher).transition("wt-1", "merge", controller.signal)).rejects.toMatchObject({
      code: "workspace-result-unknown",
      detail: { expectedState: "merged", worktreeId: "wt-1" },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps an abort during lifecycle read-back in result-unknown semantics", async () => {
    const controller = new AbortController();
    let getCount = 0;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if ((init?.method ?? "GET") === "POST") throw new Error("response lost");
      getCount += 1;
      if (getCount === 2) {
        controller.abort(new Error("cancelled"));
        throw controller.signal.reason;
      }
      return Response.json({ worktree: rawWorktree("wt-1", "ready") });
    });

    await expect(worktrees(fetcher).transition("wt-1", "merge", controller.signal)).rejects.toMatchObject({
      code: "workspace-result-unknown",
      detail: { expectedState: "merged", worktreeId: "wt-1" },
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("stops an already-aborted review before resolving its origin", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const authenticatedHttp = vi.fn();
    const configuredOrigin = vi.fn(async () => "https://workspace.test");
    const feature = new WorkspaceOpenFeature(authenticatedHttp, configuredOrigin);

    await expect(feature.createUrl({ worktreeId: "wt-1" }, controller.signal)).rejects.toThrow("cancelled");
    expect(authenticatedHttp).not.toHaveBeenCalled();
    expect(configuredOrigin).not.toHaveBeenCalled();
  });

  it("may return a response that Core confirmed while cancellation raced", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async () => {
      controller.abort(new Error("cancelled"));
      return Response.json(rawWorktree("wt-created"));
    });

    await expect(worktrees(fetcher).create({ name: "Draft", scope: { kind: "user" } }, controller.signal)).resolves.toMatchObject({ id: "wt-created" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

function worktrees(fetcher: typeof fetch): WorkspaceWorktreeFeature {
  return new WorkspaceWorktreeFeature(async () => http(fetcher));
}

function units(fetcher: typeof fetch): WorkspaceUnitFeature {
  return new WorkspaceUnitFeature(async () => http(fetcher));
}

function openFor(source: readonly Record<string, unknown>[]): WorkspaceOpenFeature {
  return new WorkspaceOpenFeature(
    async () =>
      http(async () =>
        Response.json({ worktree: rawWorktree("wt-1", "draft", source) }),
      ),
    async () => "https://workspace.test",
  );
}

function http(fetcher: typeof fetch): WorkspaceHttp {
  return new WorkspaceHttp({
    cookie: "workspace_session=test",
    fetcher,
    origin: "https://workspace.test",
    role: "client",
  });
}

function rawWorktree(
  id: string,
  state: WorkspaceWorktreeState = "draft",
  units: readonly Record<string, unknown>[] = [],
): Record<string, unknown> {
  return { id, name: "Draft", state, teamSpace: null, units };
}

function rawUnit(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    activationState: "notApplicable",
    change: "unchanged",
    draftHeadRevision: 0,
    mergeResult: "pending",
    name: "Sheet",
    nodeId: "node-1",
    resourceId: "resource-1",
    source: "trunk",
    target: null,
    unitId: "unit-1",
    unitType: "sheet",
    ...overrides,
  };
}
