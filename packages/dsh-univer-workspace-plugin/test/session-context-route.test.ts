import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserApiHandler } from "../src/webServer/plugin.ts";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

describe("Workspace Session context route", () => {
  it("keeps the session context behind the process-bound identity", async () => {
    const item = {
      resourceId: "resource-1",
      unitId: "unit-1",
      unitType: "sheet",
      nodeId: "node-1",
      spaceId: "space-1",
      name: "Budget",
      accessRole: "editor",
    } as const;
    const service = {
      list: vi.fn(async (sessionId: string) => (sessionId === "session-1" ? [item] : [])),
      add: vi.fn(async () => [item]),
      remove: vi.fn(async () => []),
    };
    const context = {
      get(name: string) {
        if (name === "workspaceAuth") {
          return {
            currentIdentity: () => ({ userId: "user-1", username: "alice" }),
            currentClient: () => ({ request: vi.fn() }),
          };
        }
        if (name === "workspaceSessionContext") return service;
        return undefined;
      },
    } as unknown as Context;
    const handler = createBrowserApiHandler(context, {
      license: "",
      workspaceRoot: "/tmp/session-context-route-test",
      workspaceOrigin: "https://workspace.test",
      publicOrigin: "http://127.0.0.1",
      templates: [],
    });
    const server = createServer((incoming, outgoing) => {
      void handler(incoming, outgoing);
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;

    const listed = await fetch(
      `${origin}/univer-workspace/api/session-context?sessionId=session-1`,
    );
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({ items: [item] });
    const added = await fetch(
      `${origin}/univer-workspace/api/session-context?sessionId=session-1`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceId: item.resourceId }),
      },
    );
    expect(added.status).toBe(200);
    expect(service.add).toHaveBeenCalledWith("session-1", item.resourceId);

    const removed = await fetch(
      `${origin}/univer-workspace/api/session-context?sessionId=session-1`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceId: item.resourceId }),
      },
    );
    expect(removed.status).toBe(200);
    expect(service.remove).toHaveBeenCalledWith("session-1", item.resourceId);
  });

  it("rejects malformed session and Resource inputs before calling the service", async () => {
    const service = { list: vi.fn(), add: vi.fn(), remove: vi.fn() };
    const context = {
      get(name: string) {
        if (name === "workspaceAuth") {
          return {
            currentIdentity: () => ({ userId: "user-1", username: "alice" }),
            currentClient: () => ({ request: vi.fn() }),
          };
        }
        if (name === "workspaceSessionContext") return service;
        return undefined;
      },
    } as unknown as Context;
    const handler = createBrowserApiHandler(context, {
      license: "",
      workspaceRoot: "/tmp/session-context-route-test",
      workspaceOrigin: "https://workspace.test",
      publicOrigin: "http://127.0.0.1",
      templates: [],
    });
    const server = createServer((incoming, outgoing) => {
      void handler(incoming, outgoing);
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;

    const invalidSession = await fetch(
      `${origin}/univer-workspace/api/session-context?sessionId=${encodeURIComponent("bad/id")}`,
    );
    expect(invalidSession.status).toBe(400);
    const invalidResource = await fetch(
      `${origin}/univer-workspace/api/session-context?sessionId=session-1`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceId: "" }),
      },
    );
    expect(invalidResource.status).toBe(400);
    expect(service.add).not.toHaveBeenCalled();
  });
});

describe("Session file recovery route", () => {
  it("uses account-owned history and rejects invalid IDs and stale identity responses", async () => {
    let userId: string | undefined = "user-1";
    let changeDuringLoad = false;
    const load = vi.fn(async () => {
      if (changeDuringLoad) userId = "user-2";
      return { events: [] };
    });
    const context = {
      get(name: string) {
        if (name === "workspaceAuth") return {
          currentIdentity: () => userId === undefined ? undefined : { userId, username: "test" },
          currentClient: () => ({ origin: "https://workspace.test", sessionToken: userId }),
        };
        if (name === "sessions") return { get: () => undefined };
        if (name === "sessionPersistence") return { open: vi.fn(async () => ({ read: load, close: vi.fn(async () => {}) })) };
        return undefined;
      },
    } as unknown as Context;
    const handler = createBrowserApiHandler(context, {
      license: "", workspaceRoot: "/tmp/session-recovery-test", workspaceOrigin: "https://workspace.test",
      publicOrigin: "http://127.0.0.1", templates: [],
    });
    const server = createServer((req, res) => { void handler(req, res); });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = (id = "session-test") => fetch(`${origin}/univer-workspace/api/session-files?sessionId=${encodeURIComponent(id)}`);
    expect((await request("../other-user")).status).toBe(400);
    expect(load).not.toHaveBeenCalled();
    const restored = await request();
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toEqual({ files: [], turns: [] });
    changeDuringLoad = true;
    expect((await request()).status).toBe(409);
    userId = undefined;
    expect((await request()).status).toBe(401);
  });
});
