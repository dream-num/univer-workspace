import type { Context } from "@deepseek-ai/cordis";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceResourceInputSource,
  createWorkspaceResourceReferenceCodec,
  decodeWorkspaceResourceReference,
  encodeWorkspaceResourceReference,
  fetchWorkspaceResourceDescriptor,
  insertWorkspaceResourceReference,
  migrateWorkspaceResourceDraftReferences,
  narrowWorkspaceResourceDescriptor,
  prioritizeWorkspaceResources,
  projectWorkspaceResourceMessageText,
  workspaceResourceClipboardText,
  type WorkspaceResourceReferenceContext,
  type WorkspaceResourceDescriptor,
} from "../src/client/workspace-resource-reference.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const descriptor: WorkspaceResourceDescriptor = {
  resourceId: "resource-1",
  unitId: "unit-1",
  unitType: "sheet",
  nodeId: "node-1",
  spaceId: "space-1",
  name: "Q3 Budget",
  accessRole: "editor",
};

function response(value: Partial<WorkspaceResourceDescriptor> = {}) {
  const current = { ...descriptor, ...value };
  return {
    resource: {
      id: current.resourceId,
      kind: "univer",
      unitId: current.unitId,
      unitType: current.unitType,
    },
    node: {
      id: current.nodeId,
      spaceId: current.spaceId,
      name: current.name,
      accessRole: current.accessRole,
      resource: {
        id: current.resourceId,
        kind: "univer",
        unitId: current.unitId,
        unitType: current.unitType,
      },
    },
  };
}

describe("Workspace Resource reference", () => {
  it("puts the current Session Space first while preserving stable order elsewhere", () => {
    const resources = [
      { ...descriptor, resourceId: "other-1", spaceId: "space-2" },
      { ...descriptor, resourceId: "current-1", spaceId: "space-1" },
      { ...descriptor, resourceId: "other-2", spaceId: "space-3" },
      { ...descriptor, resourceId: "current-2", spaceId: "space-1" },
    ];
    expect(
      prioritizeWorkspaceResources(resources, "space-1").map((item) => item.resourceId),
    ).toEqual(["current-1", "current-2", "other-1", "other-2"]);
    expect(prioritizeWorkspaceResources(resources, undefined)).toEqual(resources);
  });

  it("projects model wire objects to native display chips without changing ordinary JSON", () => {
    const first = JSON.stringify({
      kind: "univer-workspace-resource",
      resourceId: "resource-1",
      unitId: "unit-1",
      unitType: "sheet",
      nodeId: "node-1",
      spaceId: "space-1",
      name: "Q3 Budget",
      accessRole: "editor",
      selection: { kind: "sheet-range", sheetName: "Sheet1", a1Notation: "A1:B3" },
    });
    const second = JSON.stringify({
      kind: "univer-workspace-resource",
      resourceId: "resource-2",
      unitId: "unit-2",
      unitType: "doc",
      nodeId: "node-2",
      spaceId: "space-2",
      name: "Project Overview",
      accessRole: "viewer",
    });

    expect(projectWorkspaceResourceMessageText(`Compare ${first} and ${second}`)).toBe(
      "Compare @[Q3 Budget](dsh-session:univer-workspace-resource:resource-1) and @[Project Overview](dsh-session:univer-workspace-resource:resource-2)",
    );
    expect(projectWorkspaceResourceMessageText('{"kind":"other","name":"Plain object"}')).toBe(
      '{"kind":"other","name":"Plain object"}',
    );
  });

  it("narrows the authoritative Resource and Node projection", () => {
    expect(narrowWorkspaceResourceDescriptor(response(), "resource-1")).toEqual(descriptor);
  });

  it("loads the authoritative descriptor through the same-origin read proxy", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(response()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWorkspaceResourceDescriptor("resource-1", signal)).resolves.toEqual(
      descriptor,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/univer-workspace/api/resources/resource-1",
      expect.objectContaining({
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal,
      }),
    );
  });

  it.each([
    [401, "workspace_connection_required"],
    [403, "workspace_resource_unavailable"],
    [404, "workspace_resource_unavailable"],
    [503, "workspace_resource_lookup_failed:503"],
  ])("maps Resource lookup status %s without fallback", async (status, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );
    await expect(
      fetchWorkspaceResourceDescriptor("resource-1", new AbortController().signal),
    ).rejects.toThrow(message);
  });

  it.each([
    [{}, "resource-1"],
    [response({ resourceId: "other" }), "resource-1"],
    [
      {
        ...response(),
        resource: { id: "resource-1", kind: "blob" },
      },
      "resource-1",
    ],
    [
      {
        ...response(),
        node: { ...response().node, resource: { ...response().node.resource, unitId: "other" } },
      },
      "resource-1",
    ],
  ])("rejects malformed or mismatched product data", (raw, requestedResourceId) => {
    expect(() => narrowWorkspaceResourceDescriptor(raw, requestedResourceId)).toThrow(
      "workspace_resource_malformed",
    );
  });

  it("keeps Resource identity stable while retaining a display-only label cache", () => {
    const ref = encodeWorkspaceResourceReference({
      resourceId: "resource-1",
      label: "Budget ] \\ Draft",
    });
    expect(decodeWorkspaceResourceReference(ref)).toEqual({
      resourceId: "resource-1",
      label: "Budget ] \\ Draft",
    });
    expect(workspaceResourceClipboardText(ref)).toBe(
      "@[Budget \\] \\\\ Draft](univer-workspace-resource:resource-1)",
    );
  });

  it("round-trips a sheet selection without changing the Resource identity", () => {
    const ref = encodeWorkspaceResourceReference({
      resourceId: "resource-1",
      label: "Budget",
      selection: { kind: "sheet-range", sheetName: "Sheet1", a1Notation: "A1:B3" },
    });
    expect(decodeWorkspaceResourceReference(ref)).toEqual({
      resourceId: "resource-1",
      label: "Budget",
      selection: { kind: "sheet-range", sheetName: "Sheet1", a1Notation: "A1:B3" },
    });
    expect(workspaceResourceClipboardText(ref)).toContain("Sheet1!A1:B3");
  });

  it("revalidates at serialization and uses the authoritative current descriptor", async () => {
    const signal = new AbortController().signal;
    const resolve = vi.fn(async () => ({ ...descriptor, name: "Q3 Budget (renamed)" }));
    const codec = createWorkspaceResourceReferenceCodec(resolve);
    const ref = encodeWorkspaceResourceReference({ resourceId: "resource-1", label: "Old name" });

    await expect(codec.serialize(ref, signal)).resolves.toBe(
      JSON.stringify({
        kind: "univer-workspace-resource",
        resourceId: "resource-1",
        unitId: "unit-1",
        unitType: "sheet",
        nodeId: "node-1",
        spaceId: "space-1",
        name: "Q3 Budget (renamed)",
        accessRole: "editor",
      }),
    );
    expect(resolve).toHaveBeenCalledWith("resource-1", signal);
    expect(codec.clipboardText(ref)).toBe("@[Old name](univer-workspace-resource:resource-1)");
  });

  it("serializes selection context next to authoritative Resource metadata", async () => {
    const codec = createWorkspaceResourceReferenceCodec(async () => descriptor);
    const ref = encodeWorkspaceResourceReference({
      resourceId: "resource-1",
      label: "Budget",
      selection: { kind: "text", text: "Selected paragraph" },
    });
    await expect(codec.serialize(ref, new AbortController().signal)).resolves.toBe(
      JSON.stringify({
        kind: "univer-workspace-resource",
        resourceId: "resource-1",
        unitId: "unit-1",
        unitType: "sheet",
        nodeId: "node-1",
        spaceId: "space-1",
        name: "Q3 Budget",
        accessRole: "editor",
        selection: { kind: "text", text: "Selected paragraph" },
      }),
    );
  });

  it("propagates access revocation instead of degrading to clipboard text", async () => {
    const codec = createWorkspaceResourceReferenceCodec(async () => {
      throw new Error("workspace_resource_unavailable");
    });
    const ref = encodeWorkspaceResourceReference({ resourceId: "resource-1", label: "Budget" });
    await expect(codec.serialize(ref, new AbortController().signal)).rejects.toThrow(
      "workspace_resource_unavailable",
    );
  });

  it("maps discovered Resources to native @ candidates and structured picks", async () => {
    const source = createWorkspaceResourceInputSource(async () => [descriptor]);
    const candidates = await source.candidates(
      { sessionId: "session-1" as SessionId },
      {
        query: "Budget",
        position: "inline",
        drilled: false,
        signal: new AbortController().signal,
      },
    );
    expect(candidates).toEqual([expect.objectContaining({ name: "Q3 Budget", icon: "file" })]);
    const picked = source.onPick({
      candidate: candidates[0]!,
      session: { sessionId: "session-1" as SessionId },
      position: "inline",
      via: "menu",
      action: "pick",
      span: { start: 0, end: 3, draftRev: 1 },
    });
    expect(picked).toEqual({
      insert: expect.objectContaining({
        source: "univer-workspace-resource",
        label: "Q3 Budget",
      }),
    });
  });

  it("discovers projected resources and exposes an honest Workspace browse drill", async () => {
    const browseSpace = {
      spaceId: "space-1",
      type: "personal",
      name: "Personal Space",
    };
    const projected = response();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path.endsWith("/recent-resources?limit=50")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                ...projected,
                location: {
                  space: browseSpace,
                  breadcrumbs: [{ id: "folder-1", name: "Budget" }],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (path.endsWith("/owned-by-me?limit=50")) {
        return new Response(JSON.stringify({ items: [projected] }), { status: 200 });
      }
      if (path.endsWith("/shared-with-me?limit=50")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (path.endsWith("/spaces")) {
        return new Response(JSON.stringify({ spaces: [browseSpace] }), { status: 200 });
      }
      if (path.includes("/spaces/space-1/nodes")) {
        return new Response(
          JSON.stringify({
            documents: [
              {
                nodeId: "node-1",
                name: "Q3 Budget",
                parentNodeId: null,
                hasChildren: false,
                resourceId: "resource-1",
                unitId: "unit-1",
                unitType: "sheet",
                accessRole: "editor",
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const source = createWorkspaceResourceInputSource();
    const session = { sessionId: "session-discovery" as SessionId };
    const request = (query: string) => ({
      query,
      position: "inline" as const,
      drilled: query.startsWith("workspace:"),
      signal: new AbortController().signal,
    });

    const recent = await source.candidates(session, request(""));
    expect(recent).toEqual([
      expect.objectContaining({
        name: "Q3 Budget",
        description: "Personal Space / Budget",
        icon: "file",
      }),
      expect.objectContaining({ name: "Browse Workspace", icon: "folder", drill: true }),
    ]);
    const browsePick = source.onPick({
      candidate: recent[1]!,
      session,
      position: "inline",
      via: "menu",
      action: "drill",
      span: { start: 0, end: 1, draftRev: 1 },
    });
    expect(browsePick).toEqual({ text: "@workspace:", continue: true });

    const spaces = await source.candidates(session, request("workspace:"));
    expect(spaces).toEqual([
      expect.objectContaining({
        name: "Personal Space",
        description: "Personal Space",
        drill: true,
      }),
    ]);
    const spacePath = `workspace:space:space-1:${encodeURIComponent("Personal Space")}/`;
    const spaceCrumbs = source.header?.(session, {
      query: spacePath,
      drilled: true,
    });
    expect(spaceCrumbs?.map(({ label }) => label)).toEqual(["Workspace", "Personal Space"]);
    const files = await source.candidates(session, request(spacePath));
    expect(files).toEqual([expect.objectContaining({ name: "Q3 Budget", icon: "file" })]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/spaces/space-1/nodes"),
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("appends a structured reference to the scoped native composer", () => {
    const insertReference = vi.fn(() => true);
    const scope = {} as Context;
    const ctx = {
      sessions: { scope: vi.fn(() => scope) },
      conversation: {
        input: {
          for: vi.fn(() => ({
            state: {
              getSnapshot: () => ({ draft: "Compare these files:", draftRev: 7, phase: "plain" }),
            },
            insertReference,
          })),
        },
      },
    } as unknown as WorkspaceResourceReferenceContext;

    expect(insertWorkspaceResourceReference(ctx, "session-1", descriptor)).toEqual({
      kind: "inserted",
    });
    expect(ctx.sessions.scope).toHaveBeenCalledWith("session-1");
    expect(insertReference).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "univer-workspace-resource",
        label: "Q3 Budget",
        appearance: "file",
        clipboardText: "@[Q3 Budget](univer-workspace-resource:resource-1)",
      }),
      { start: 20, end: 20, draftRev: 7 },
    );
  });

  it("retries once when the native composer commits a concurrent chip", () => {
    let revision = 7;
    const insertReference = vi.fn(
      (_reference: unknown, _span: { start: number; end: number; draftRev: number }) => {
        if (insertReference.mock.calls.length === 1) {
          revision += 1;
          return false;
        }
        return true;
      },
    );
    const scope = {} as Context;
    const ctx = {
      sessions: { scope: vi.fn(() => scope) },
      conversation: {
        input: {
          for: vi.fn(() => ({
            state: {
              getSnapshot: () => ({ draft: "Existing file ", draftRev: revision, phase: "plain" }),
            },
            insertReference,
          })),
        },
      },
    } as unknown as WorkspaceResourceReferenceContext;

    expect(insertWorkspaceResourceReference(ctx, "session-1", descriptor)).toEqual({
      kind: "inserted",
    });
    expect(insertReference).toHaveBeenCalledTimes(2);
    expect(insertReference.mock.calls[0]?.[1]).toEqual({ start: 14, end: 14, draftRev: 7 });
    expect(insertReference.mock.calls[1]?.[1]).toEqual({ start: 14, end: 14, draftRev: 8 });
  });

  it("fails closed for missing, busy, or concurrently changed Session input", () => {
    const input = {
      state: {
        getSnapshot: () => ({ draft: "text", draftRev: 3, phase: "submitting" }),
      },
      insertReference: vi.fn(() => false),
    };
    const scope = {} as Context;
    const ctx = {
      sessions: { scope: vi.fn(() => undefined as Context | undefined) },
      conversation: { input: { for: vi.fn(() => input) } },
    } as unknown as WorkspaceResourceReferenceContext;

    expect(insertWorkspaceResourceReference(ctx, "missing", descriptor)).toEqual({
      kind: "session-unavailable",
    });
    expect(ctx.conversation.input.for).not.toHaveBeenCalled();

    vi.mocked(ctx.sessions.scope).mockReturnValue(scope);
    expect(insertWorkspaceResourceReference(ctx, "busy", descriptor)).toEqual({
      kind: "input-busy",
      phase: "submitting",
    });
    expect(input.insertReference).not.toHaveBeenCalled();

    input.state.getSnapshot = () => ({ draft: "text", draftRev: 4, phase: "plain" });
    expect(insertWorkspaceResourceReference(ctx, "stale", descriptor)).toEqual({
      kind: "input-changed",
    });
  });

  it("resolves input from the public Session-scoped conversation when root input is absent", () => {
    const insertReference = vi.fn(() => true);
    const scope = {
      get: vi.fn(() => ({
        input: {
          for: vi.fn(() => ({
            state: { getSnapshot: () => ({ draft: "", draftRev: 1, phase: "plain" }) },
            insertReference,
          })),
        },
      })),
    } as unknown as Context;
    const ctx = {
      sessions: { scope: vi.fn(() => scope) },
      conversation: {},
    } as unknown as WorkspaceResourceReferenceContext;

    expect(insertWorkspaceResourceReference(ctx, "session-1", descriptor)).toEqual({
      kind: "inserted",
    });
    expect(insertReference).toHaveBeenCalledOnce();
  });

  it("uses a root conversation that already exposes a bound SessionInput", () => {
    const insertReference = vi.fn(() => true);
    const input = {
      state: { getSnapshot: () => ({ draft: "", draftRev: 1, phase: "plain" }) },
      insertReference,
    };
    const ctx = {
      sessions: { scope: vi.fn(() => ({}) as Context) },
      conversation: { input },
    } as unknown as WorkspaceResourceReferenceContext;

    expect(insertWorkspaceResourceReference(ctx, "session-1", descriptor)).toEqual({
      kind: "inserted",
    });
    expect(insertReference).toHaveBeenCalledOnce();
  });

  it("upgrades persisted resource markdown into guarded native chips", async () => {
    const first = "@[Q3 Budget · Sheet1!A1:B3](univer-workspace-resource:resource-1)";
    const second = "@[Another](univer-workspace-resource:resource-2)";
    let draft = `Compare ${first} and ${second}`;
    let draftRev = 4;
    const insertReference = vi.fn(
      (reference, span: { start: number; end: number; draftRev: number }) => {
        if (span.draftRev !== draftRev) return false;
        draft = `${draft.slice(0, span.start)}${reference.clipboardText}${draft.slice(span.end)}`;
        draftRev += 1;
        return true;
      },
    );
    const input = {
      state: { getSnapshot: () => ({ draft, draftRev, phase: "plain" as const }) },
      insertReference,
    };
    const scope = {} as Context;
    const ctx = {
      sessions: { scope: vi.fn(() => scope) },
      conversation: { input: { for: vi.fn(() => input) } },
    } as unknown as WorkspaceResourceReferenceContext;
    const resolve = vi.fn(async (resourceId: string) => ({
      ...descriptor,
      resourceId,
      name: resourceId === "resource-2" ? "Another" : descriptor.name,
    }));

    await expect(
      migrateWorkspaceResourceDraftReferences(ctx, "session-1", resolve),
    ).resolves.toEqual({
      migrated: 2,
      skipped: 0,
    });
    expect(insertReference).toHaveBeenCalledTimes(2);
    expect(insertReference.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ label: "Another", source: "univer-workspace-resource" }),
    );
    expect(insertReference.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        label: "Q3 Budget",
        ref: expect.stringContaining('"selection":{"kind":"sheet-range"'),
      }),
    );
  });

  it("does not migrate ordinary text or resources that fail authoritative lookup", async () => {
    const draft = "Plain text @[Missing](univer-workspace-resource:gone)";
    const input = {
      state: { getSnapshot: () => ({ draft, draftRev: 1, phase: "plain" as const }) },
      insertReference: vi.fn(() => true),
    };
    const scope = {} as Context;
    const ctx = {
      sessions: { scope: vi.fn(() => scope) },
      conversation: { input: { for: vi.fn(() => input) } },
    } as unknown as WorkspaceResourceReferenceContext;
    await expect(
      migrateWorkspaceResourceDraftReferences(ctx, "session-1", async () => {
        throw new Error("workspace_resource_unavailable");
      }),
    ).resolves.toEqual({ migrated: 0, skipped: 1 });
    expect(input.insertReference).not.toHaveBeenCalled();
  });
});
