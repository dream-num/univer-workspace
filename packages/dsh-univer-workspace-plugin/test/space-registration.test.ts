import { Context } from "@deepseek-ai/cordis";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply as applyProvider } from "../src/provider/service-provider.ts";
import { apply as applyWeb } from "../src/webServer/plugin.ts";
import type { SpaceLinkRecord } from "../src/provider/space-links.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "workspace-registration-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const ctx = new Context();
  const remote = [
    { id: "personal", type: "personal", name: "Alice 的个人空间", accessRole: "owner", affiliation: "owner" },
    { id: "team", type: "team", name: "Team", accessRole: "editor", affiliation: "member" },
  ];
  const details = new Map(remote.map(space => [space.id, space]));
  const request = vi.fn(async (path: string) => {
    if (path === "/api/spaces") return Response.json({ spaces: remote });
    const space = details.get(decodeURIComponent(path.slice("/api/spaces/".length)));
    return space === undefined ? Response.json({}, { status: 404 }) : Response.json(space);
  });
  let authorized = true;
  let switching = false;
  ctx.provide("workspaceAuth", {
    currentIdentity: () => authorized ? { userId: "alice", username: "Alice" } : undefined,
    currentClient: () => authorized ? { origin: "https://workspace.test", sessionToken: "test", request } : undefined,
    effectiveOrigin: () => "https://workspace.test",
    switching: () => switching,
    pendingIdentity: () => undefined,
  });
  const records = new Map<string, SpaceLinkRecord>();
  const table = {
    get: (id: string) => records.get(id),
    entries: () => records.entries(),
    put: async (id: string, record: SpaceLinkRecord) => { records.set(id, record); },
    delete: async (id: string) => { records.delete(id); },
  };
  ctx.provide("storageDomain", { open: async () => ({ table: () => table, close: async () => {} }) });
  const registered = new Map<string, { id: string; path: string; title: string; sessionIds: string[]; attachSession: ReturnType<typeof vi.fn> }>();
  const create = vi.fn(async (path: string, title: string) => {
    const existing = [...registered.values()].find(workspace => workspace.path === path);
    if (existing) return existing;
    const workspace = { id: `workspace-${registered.size + 1}`, path, title, sessionIds: [], attachSession: vi.fn() };
    registered.set(workspace.id, workspace);
    return workspace;
  });
  const resolveByPath = vi.fn(async (path: string) => [...registered.values()].find(workspace => workspace.path === path));
  ctx.provide("workspaceRegistry", {
    get: (id: string) => registered.get(id),
    resolveByPath,
    create,
  });
  applyProvider(ctx, { workspaceRoot: root, workerUrl: new URL("file:///unused-worker.js"), license: "" });
  const handlers = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>>();
  ctx.provide("webServer", { register: (route: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) => {
    handlers.set(route.path, route.handler);
    return () => handlers.delete(route.path);
  } });
  applyWeb(ctx, { workspaceRoot: root, workspaceOrigin: "https://workspace.test", publicOrigin: "http://127.0.0.1", license: "", templates: [] });
  const server = createServer((req, res) => {
    const prefix = req.url?.startsWith("/api/uwh") ? "/api/uwh" : "/univer-workspace/api";
    void handlers.get(prefix)!(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.unshift(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { service: ctx.get("univerWorkspace")!, origin, registered, records, create, request, resolveByPath, remote, details,
    beginSwitch: () => { switching = true; }, logout: () => { authorized = false; } };
}

describe("Explicit Space registration", () => {
  it("links an unlisted public Space and retains it until detail access returns 404", async () => {
    const { service, request, details, records } = await setup();
    details.set("public/id", {
      id: "public/id", type: "team", name: "Public", accessRole: "viewer", affiliation: "none",
    });
    const added = await service.addSpace("alice", "public/id");
    expect(request).toHaveBeenCalledWith("/api/spaces/public%2Fid");
    expect(request).not.toHaveBeenCalledWith("/api/spaces");
    expect((await service.listSpaces("alice")).spaces).toEqual([
      expect.objectContaining({ spaceId: "personal", affiliation: "owner" }),
      expect.objectContaining({ spaceId: "team", affiliation: "member" }),
      expect.objectContaining({ spaceId: "public/id", affiliation: "none", dshWorkspaceId: added.dshWorkspaceId }),
    ]);
    details.delete("public/id");
    expect((await service.listSpaces("alice")).spaces.map(space => space.spaceId)).toEqual(["personal", "team"]);
    expect(records.has(added.dshWorkspaceId)).toBe(true);
    await expect(service.addSpace("alice", "public/id")).rejects.toThrow("workspace_space_unavailable");
  });

  it("retains a linked Space after membership ends without fetching listed Spaces twice", async () => {
    const { service, request, remote } = await setup();
    const added = await service.addSpace("alice", "team");
    request.mockClear();
    await service.listSpaces("alice");
    expect(request.mock.calls).toEqual([["/api/spaces"]]);
    remote.splice(1, 1);
    expect((await service.listSpaces("alice")).spaces).toContainEqual(
      expect.objectContaining({ spaceId: "team", dshWorkspaceId: added.dshWorkspaceId }),
    );
    expect(request).toHaveBeenCalledWith("/api/spaces/team");
  });

  it.each(["other user", "other origin", "missing registration"])(
    "does not fetch unlisted links for %s",
    async (scope) => {
      const { service, records, registered, remote, request } = await setup();
      const added = await service.addSpace("alice", "team");
      const record = records.get(added.dshWorkspaceId)!;
      if (scope === "other user") records.set(added.dshWorkspaceId, { ...record, userId: "bob" });
      if (scope === "other origin") records.set(added.dshWorkspaceId, { ...record, origin: "https://other.test" });
      if (scope === "missing registration") registered.clear();
      remote.splice(1, 1);
      request.mockClear();
      expect((await service.listSpaces("alice")).spaces.map(space => space.spaceId)).toEqual(["personal"]);
      expect(request.mock.calls).toEqual([["/api/spaces"]]);
    },
  );

  it("propagates detail failures other than 404 when linking or listing", async () => {
    const { service, request, remote } = await setup();
    await service.addSpace("alice", "team");
    remote.splice(1, 1);
    request.mockImplementation(async (path: string) => path === "/api/spaces"
      ? Response.json({ spaces: remote })
      : Response.json({ error: { code: "UNAVAILABLE", message: "try later" } }, { status: 503 }));
    await expect(service.listSpaces("alice")).rejects.toMatchObject({ status: 503, code: "UNAVAILABLE" });
    await expect(service.addSpace("alice", "team")).rejects.toMatchObject({ status: 503, code: "UNAVAILABLE" });
  });

  it("keeps a newly signed-in user's session list empty when reading identity and Spaces", async () => {
    const { origin, create, registered } = await setup();
    const identity = await fetch(`${origin}/api/uwh/me`);
    expect(identity.status).toBe(200);
    expect(await identity.json()).toMatchObject({ connected: true, identity: { userId: "alice" } });
    for (let i = 0; i < 2; i++) {
      const response = await fetch(`${origin}/univer-workspace/api/spaces`);
      const body = await response.json();
      expect(body.spaces).toHaveLength(2);
      expect(body.spaces.every((space: { dshWorkspaceId?: string }) => space.dshWorkspaceId === undefined)).toBe(true);
    }
    expect(create).not.toHaveBeenCalled();
    expect(registered.size).toBe(0);
  });

  it("adds only the selected Space, reuses it, and does not re-add a removed registration", async () => {
    const { origin, service, registered, records } = await setup();
    const url = `${origin}/univer-workspace/api/spaces/team/workspace`;
    const response = await fetch(url, { method: "POST" });
    expect(response.status).toBe(200);
    const added = await response.json();
    expect(added).toMatchObject({ dshWorkspaceId: "workspace-1" });
    expect(typeof added.path).toBe("string");
    const second = await fetch(url, { method: "POST" });
    expect(await second.json()).toEqual(added);
    expect(registered.size).toBe(1);
    expect(records.get(added.dshWorkspaceId)?.spaceId).toBe("team");
    expect((await service.listSpaces("alice")).spaces).toEqual([
      expect.not.objectContaining({ dshWorkspaceId: expect.any(String) }),
      expect.objectContaining({ spaceId: "team", dshWorkspaceId: added.dshWorkspaceId }),
    ]);
    registered.clear();
    expect((await service.listSpaces("alice")).spaces.every(space => space.dshWorkspaceId === undefined)).toBe(true);
    expect(registered.size).toBe(0);
  });

  it("rejects inaccessible Spaces and unauthenticated registration", async () => {
    const { origin, create, logout } = await setup();
    const missing = await fetch(`${origin}/univer-workspace/api/spaces/hidden/workspace`, { method: "POST" });
    expect(missing.status).toBe(404);
    logout();
    const denied = await fetch(`${origin}/univer-workspace/api/spaces/team/workspace`, { method: "POST" });
    expect(denied.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("stops registration when an account switch starts during directory resolution", async () => {
    const { service, resolveByPath, beginSwitch, create, records } = await setup();
    resolveByPath.mockImplementationOnce(async () => {
      beginSwitch();
      return undefined;
    });
    await expect(service.addSpace("alice", "team")).rejects.toThrow("workspace_connection_changed");
    expect(create).not.toHaveBeenCalled();
    expect(records.size).toBe(0);
  });
});
