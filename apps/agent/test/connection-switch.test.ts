import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import * as connectionState from "../src/connection-state.ts";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceAuthProvider } from "../src/workspace-auth-provider.ts";
import { readConnectionState, runtimeHomeFor } from "../src/connection-state.ts";
import { connectionRequestStatus } from "../src/runtime-webserver.ts";

function context(): Context {
  const ctx = new Context();
  ctx.provide("settings", {
    installSection(_owner: unknown, _name: unknown, _schema: unknown, entry: unknown, hooks: any) {
      hooks.setSource(() => entry);
    },
    async replace() {},
  });
  return ctx;
}

describe("in-process Workspace switching", () => {
  it("drains the old account before exposing new credentials and restores each account directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "uwh-switch-"));
    const ctx = context();
    const provider = new WorkspaceAuthProvider(ctx, { workspaceOrigin: "https://one.example", connectionStatePath: join(root, "connection.json") });
    const homes: string[] = [];
    let release: (() => void) | undefined;
    let draining = false;
    const fiber = ctx.inject(["workspaceRuntime"], (child) => {
      homes.push(child.get("workspaceRuntime").home);
      child.effect(() => async () => {
        if (release === undefined) return;
        draining = true;
        await new Promise<void>((resolve) => { release = resolve; });
      });
    });
    await fiber;
    const a = { userId: "same-id", username: "alice" };
    await provider.connect(a, "token-a", "https://one.example");
    await fiber.await();
    const oldClient = provider.currentClient()!;
    const oldVersion = provider.connectionVersion();
    release = () => {};
    const next = provider.connect(a, "token-b", "https://two.example");
    while (!draining) await new Promise(resolve => setTimeout(resolve, 1));
    expect(provider.currentClient()?.origin).toBe("https://one.example");
    expect(provider.switching()).toBe(true);
    release();
    release = undefined;
    await next;
    await fiber.await();
    expect(provider.connectionVersion()).not.toBe(oldVersion);
    expect(oldClient.origin).toBe("https://one.example");
    expect(oldClient.sessionToken).toBe("token-a");
    expect(provider.currentClient()?.sessionToken).toBe("token-b");
    await provider.connect(a, "renewed", "https://one.example");
    await fiber.await();
    expect(homes[1]).toBe(homes[3]);
    expect(homes[2]).not.toBe(homes[1]);
    expect(homes[1]).toBe(runtimeHomeFor(root, {origin:"https://one.example",identity:a,sessionToken:"unused"}));
    await expect(readConnectionState(join(root, "connection.json"))).resolves.toMatchObject({active:{sessionToken:"renewed"}});
    await provider.disconnect();
    await fiber.await();
    expect(provider.currentClient()).toBeUndefined();
    expect(homes.at(-1)).toBe(homes[0]);
    await fiber.dispose();
  });

  it("restores the prior runtime when persisting the new connection fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "uwh-switch-failure-"));
    const ctx = context();
    const provider = new WorkspaceAuthProvider(ctx, { workspaceOrigin: "https://one.example", connectionStatePath: join(root, "connection.json") });
    await provider.connect({userId:"a",username:"alice"}, "old", "https://one.example");
    const previousHome = ctx.get("workspaceRuntime").home;
    const failure = vi.spyOn(connectionState, "writeConnectionState").mockRejectedValueOnce(new Error("Disk unavailable"));
    try {
      await expect(provider.connect({userId:"b",username:"bob"}, "new", "https://two.example")).rejects.toThrow("Disk unavailable");
      expect(provider.currentIdentity()?.userId).toBe("a");
      expect(provider.switching()).toBe(false);
      expect(ctx.get("workspaceRuntime").home).toBe(previousHome);
    } finally { failure.mockRestore(); }
    await provider.connect({userId:"b",username:"bob"}, "new", "https://two.example");
    expect(provider.currentIdentity()?.userId).toBe("b");
  });

  it("rejects stale documents and refuses requests while runtime services are unavailable", () => {
    const state = { connectionVersion: () => "new", runtimeReady: () => true };
    expect(connectionRequestStatus(state, "old")).toBe(409);
    expect(connectionRequestStatus(state, undefined)).toBe(409);
    expect(connectionRequestStatus(state, "new")).toBeUndefined();
    expect(connectionRequestStatus({...state,runtimeReady:()=>false}, "new")).toBe(503);
  });
});
