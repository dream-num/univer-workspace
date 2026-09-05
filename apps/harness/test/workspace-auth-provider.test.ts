import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import { readConnectionState, writeConnectionState } from "../src/connection-state.ts";
import {
  WorkspaceAuthProvider,
  type WorkspaceAuthSettings,
} from "../src/workspace-auth-provider.ts";

describe("WorkspaceAuthProvider origin selection", () => {
  it("ignores a restored identity runtime's stale setting until the user changes it", async () => {
    const root = await mkdtemp(join(tmpdir(), "uwh-auth-provider-"));
    const statePath = join(root, "connection.json");
    await writeConnectionState(statePath, {
      origin: "https://workspace.univer.plus",
      identity: { userId: "user-b", username: "bob" },
      sessionToken: "token-b",
    });

    const ctx = new Context();
    let settings: WorkspaceAuthSettings = { workspaceOrigin: "http://127.0.0.1:3021" };
    let notifyChange: (() => void) | undefined;
    let base: WorkspaceAuthSettings | undefined;
    let hooks:
      | {
          setSource(source: () => WorkspaceAuthSettings): void;
          onChange(): void;
        }
      | undefined;
    ctx.provide("settings", {
      installSection(
        _owner: Context,
        _namespace: string,
        _schema: unknown,
        entry: WorkspaceAuthSettings,
        nextHooks: {
          setSource(source: () => WorkspaceAuthSettings): void;
          onChange(): void;
        },
      ) {
        base = entry;
        hooks = nextHooks;
        nextHooks.setSource(() => settings);
        nextHooks.onChange();
        notifyChange = nextHooks.onChange;
      },
      async replace(_namespace: string, section: object) {
        if (Object.keys(section).length === 0 && base !== undefined && hooks !== undefined) {
          settings = base;
          hooks.onChange();
        }
      },
    });

    const provider = new WorkspaceAuthProvider(ctx, {
      workspaceOrigin: "https://default.example",
      connectionStatePath: statePath,
    });

    expect(provider.loginOrigin()).toBe("https://workspace.univer.plus");
    await vi.waitFor(() => {
      expect(settings.workspaceOrigin).toBe("https://workspace.univer.plus");
    });
    await provider.stageDisconnect();
    await expect(readConnectionState(statePath)).resolves.toEqual({
      version: 1,
      configuredOrigin: "https://workspace.univer.plus",
    });

    settings = { workspaceOrigin: "https://next.example/path" };
    notifyChange?.();
    expect(provider.loginOrigin()).toBe("https://next.example");
    await provider.stageConnection(
      { userId: "user-next", username: "next" },
      "token-next",
      provider.loginOrigin(),
    );
    await expect(readConnectionState(statePath)).resolves.toMatchObject({
      configuredOrigin: "https://next.example",
      active: {
        origin: "https://next.example",
        identity: { userId: "user-next", username: "next" },
      },
    });
  });

  it("imports the previous bootstrap setting when no shared origin exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "uwh-auth-provider-"));
    const statePath = join(root, "connection.json");
    const ctx = new Context();
    const settings = { workspaceOrigin: "https://legacy-bootstrap.example/path" };
    ctx.provide("settings", {
      installSection(
        _owner: Context,
        _namespace: string,
        _schema: unknown,
        _entry: WorkspaceAuthSettings,
        hooks: {
          setSource(source: () => WorkspaceAuthSettings): void;
          onChange(): void;
        },
      ) {
        hooks.setSource(() => settings);
        hooks.onChange();
      },
      async replace() {
        throw new Error("bootstrap migration must not clear the legacy setting");
      },
    });

    const provider = new WorkspaceAuthProvider(ctx, {
      workspaceOrigin: "https://default.example",
      connectionStatePath: statePath,
    });

    expect(provider.loginOrigin()).toBe("https://legacy-bootstrap.example");
    await provider.stageConnection(
      { userId: "legacy-user", username: "legacy" },
      "legacy-token",
      provider.loginOrigin(),
    );
    await expect(readConnectionState(statePath)).resolves.toMatchObject({
      configuredOrigin: "https://legacy-bootstrap.example",
      active: { origin: "https://legacy-bootstrap.example" },
    });
  });
});
