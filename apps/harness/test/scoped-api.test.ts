import { describe, expect, it } from "vitest";
import {
  authorizeScopedRequest,
  normalizedPath,
  projectSessionListValue,
  projectSessionSearchValue,
  projectHostDescribeValue,
  projectHostPickDirectoryValue,
  projectWorkspaceOrderValue,
  projectArchivedSessionsValue,
  projectWorkspaceListValue,
  projectAgentPresetListValue,
  projectSettingsDescribeValue,
  trustedRequest,
  HARNESS_SETTINGS_NAMESPACE,
  ONBOARDING_SETTINGS_NAMESPACE,
  type Scope,
} from "../src/scoped-api.js";

const ownPath = "/srv/harness/users/u1/space-a";
const scope: Scope = {
  sessionRootPath: "/srv/harness/users/u1",
  workspaceIds: new Set(["space-a", "manual-own"]),
  workspacePaths: new Set([ownPath, "/srv/harness/users/u1/manual"]),
  sessionIds: new Set(["session-own", "session-ungrouped"]),
  agentPresetIds: new Set(["standard"]),
  defaultAgentPresetId: "standard",
};

describe("scoped DSH list projections", () => {
  it("canonicalizes traversal before applying the account boundary", () => {
    expect(normalizedPath(`${scope.sessionRootPath}/space-a/../other`)).toBe(`${scope.sessionRootPath}/other`);
    expect(authorizeScopedRequest("workspace.create", { path: `${scope.sessionRootPath}/space-a/../other` }, scope)).toMatchObject({ ok: true });
    expect(authorizeScopedRequest("workspace.create", { path: `${scope.sessionRootPath}/../u2` }, scope)).toMatchObject({ ok: false, error: { code: "workspace-invalid-path" } });
  });

  it("pins an unqualified new session and rejects foreign addresses", () => {
    const scoped: Scope = {
      ...scope,
      workspaceSessionsById: new Map([["space-a", new Set(["session-own"])]]) as ReadonlyMap<string, ReadonlySet<string>>,
    };
    expect(authorizeScopedRequest("session.create", {}, scoped)).toEqual({ ok: true, payload: { cwd: scoped.sessionRootPath } });
    expect(authorizeScopedRequest("session.history", { sessionId: "session-foreign" }, scoped)).toMatchObject({ ok: false, error: { code: "session-not-found" } });
    expect(authorizeScopedRequest("session.create", { sessionId: "session-foreign" }, scoped)).toMatchObject({ ok: false, error: { code: "session-not-found" } });
    expect(authorizeScopedRequest("workspace.insertSessionBefore", { workspaceId: "space-a", sessionId: "session-own" }, scoped)).toMatchObject({ ok: true });
    expect(authorizeScopedRequest("session.fork", { sessionId: "session-foreign" }, scoped)).toMatchObject({ ok: false, error: { code: "session-not-found" } });
    expect(authorizeScopedRequest("session.fork", { sessionId: "session-own" }, scoped)).toMatchObject({ ok: true });
  });

  it("keeps profile-global settings deployment-bound unless model settings are explicitly enabled", () => {
    const scoped: Scope = { ...scope, allowedWorkspaceOrigin: "https://workspace.example/" };
    expect(projectSettingsDescribeValue({
      writable: true,
      namespaces: [
        { ns: HARNESS_SETTINGS_NAMESPACE },
        { ns: "llm-provider-secret" },
      ],
    })).toEqual({ writable: true, namespaces: [{ ns: HARNESS_SETTINGS_NAMESPACE }] });
    expect(authorizeScopedRequest("settings.update", {
      ns: "llm-provider-secret",
      patch: { apiKey: "leak" },
    }, scoped)).toMatchObject({ ok: false, error: { code: "settings-rejected" } });
    expect(authorizeScopedRequest("settings.update", {
      ns: HARNESS_SETTINGS_NAMESPACE,
      patch: { workspaceOrigin: "https://evil.example" },
    }, scoped)).toMatchObject({ ok: false, error: { code: "settings-rejected" } });
    expect(authorizeScopedRequest("settings.update", {
      ns: HARNESS_SETTINGS_NAMESPACE,
      patch: { workspaceOrigin: "https://workspace.example" },
    }, scoped)).toMatchObject({ ok: true });
    expect(authorizeScopedRequest("settings.mutate", {
      ns: HARNESS_SETTINGS_NAMESPACE,
      ops: [{ op: "unset", path: ["workspaceOrigin"] }],
    }, scoped)).toMatchObject({ ok: false, error: { code: "settings-rejected" } });
    expect(authorizeScopedRequest("credentials.set", { ref: "OPENAI_API_KEY", value: "secret" }, scoped)).toMatchObject({ ok: false, error: { code: "credential-rejected" } });

    const modelEnabled: Scope = { ...scoped, modelSettingsEnabled: true };
    expect(projectSettingsDescribeValue({
      writable: true,
      namespaces: [
        { ns: HARNESS_SETTINGS_NAMESPACE },
        { ns: "llm-deepseek" },
        { ns: "llm-pi-ai" },
        { ns: "unrelated-global-settings" },
      ],
    }, true)).toEqual({
      writable: true,
      namespaces: [
        { ns: HARNESS_SETTINGS_NAMESPACE },
        { ns: "llm-deepseek" },
        { ns: "llm-pi-ai" },
      ],
    });
    expect(authorizeScopedRequest("settings.update", {
      ns: "llm-deepseek",
      patch: { apiKeyEnv: "DEEPSEEK_API_KEY" },
    }, modelEnabled)).toMatchObject({ ok: true });
    expect(authorizeScopedRequest("credentials.set", { ref: "DEEPSEEK_API_KEY", value: "secret" }, modelEnabled)).toMatchObject({ ok: true });

    expect(projectSettingsDescribeValue({
      writable: true,
      namespaces: [
        { ns: HARNESS_SETTINGS_NAMESPACE },
        { ns: ONBOARDING_SETTINGS_NAMESPACE },
        { ns: "unrelated-global-settings" },
      ],
    }, true)).toEqual({
      writable: true,
      namespaces: [
        { ns: HARNESS_SETTINGS_NAMESPACE },
        { ns: ONBOARDING_SETTINGS_NAMESPACE },
      ],
    });
    expect(authorizeScopedRequest("settings.mutate", {
      ns: ONBOARDING_SETTINGS_NAMESPACE,
      ops: [{ op: "set", path: ["welcomeNoticeVersion"], value: "2026-08-13.1" }],
    }, modelEnabled)).toMatchObject({ ok: true });
    expect(authorizeScopedRequest("settings.mutate", {
      ns: ONBOARDING_SETTINGS_NAMESPACE,
      ops: [{ op: "set", path: ["other"], value: "not-allowed" }],
    }, modelEnabled)).toMatchObject({ ok: false, error: { code: "settings-rejected" } });
    expect(authorizeScopedRequest("settings.mutate", {
      ns: ONBOARDING_SETTINGS_NAMESPACE,
      ops: [{ op: "set", path: ["welcomeNoticeVersion"], value: "2026-08-13.1" }],
    }, scoped)).toMatchObject({ ok: false, error: { code: "settings-rejected" } });
  });

  it("keeps profile-global agent presets deployment-owned", () => {
    expect(projectAgentPresetListValue(scope, {
      presets: [
        { id: "standard", trust: "system", isDefault: true },
        { id: "private-user-preset", trust: "user", isDefault: false },
      ],
      authorable: true,
      hasDocument: true,
    })).toEqual({
      presets: [{ id: "standard", trust: "system", isDefault: true }],
      authorable: false,
      hasDocument: false,
    });
    expect(authorizeScopedRequest("agentPreset.read", { agentPreset: "private-user-preset" }, scope)).toMatchObject({
      ok: false,
      error: { code: "agent-preset-not-found" },
    });
    expect(authorizeScopedRequest("agentPreset.copy", { from: "standard", agentPreset: "private-copy" }, scope)).toMatchObject({
      ok: false,
      error: { code: "agent-preset-authoring-disabled" },
    });
    expect(authorizeScopedRequest("session.create", { agentPreset: "private-user-preset" }, scope)).toMatchObject({
      ok: false,
      error: { code: "agent-preset-not-found" },
    });
  });

  it("rejects cross-site and mismatched-host requests", () => {
    const base = { host: "127.0.0.1:3081", origin: "http://127.0.0.1:3081" };
    expect(trustedRequest({ headers: base } as any, "http://127.0.0.1:3081")).toBe(true);
    expect(trustedRequest({ headers: { ...base, "sec-fetch-site": "cross-site" } } as any, "http://127.0.0.1:3081")).toBe(false);
    expect(trustedRequest({ headers: { ...base, origin: "http://evil.example" } } as any, "http://127.0.0.1:3081")).toBe(false);
  });

  it("projects process-global host snapshots and order responses", () => {
    expect(projectHostDescribeValue({ ...scope, sessionIds: new Set(["session-own"]) }, {
      cwd: "/tmp",
      home: "/root",
      attachedSessions: 99,
    })).toMatchObject({ cwd: scope.sessionRootPath, home: scope.sessionRootPath, attachedSessions: 1 });
    expect(projectWorkspaceOrderValue(scope, {
      workspaceIds: ["space-a", "foreign", "manual-own"],
    })).toEqual({ workspaceIds: ["space-a", "manual-own"] });
    expect(projectArchivedSessionsValue(scope, {
      archivedSessionIds: ["session-foreign", "session-own"],
    })).toEqual({ archivedSessionIds: ["session-own"] });
  });

  it("redacts a host directory picker result outside the account root", () => {
    expect(projectHostPickDirectoryValue(scope, { path: "/root/private" })).toEqual({ path: null });
    expect(projectHostPickDirectoryValue(scope, { path: `${scope.sessionRootPath}/space-a` })).toEqual({ path: `${scope.sessionRootPath}/space-a` });
  });

  it("rewrites an omitted host directory to the private user root", () => {
    expect(authorizeScopedRequest("host.listDirectory", {}, scope)).toEqual({ ok: true, payload: { path: scope.sessionRootPath } });
    expect(authorizeScopedRequest("host.listDirectory", { path: "/root" }, scope)).toMatchObject({ ok: false, error: { code: "directory-unreadable" } });
  });

  it("keeps every account-local workspace, including a manually adopted one", () => {
    const value = projectWorkspaceListValue(scope, {
      items: [
        { workspaceId: "space-a", path: ownPath, sessionIds: ["session-own", "session-foreign"] },
        { workspaceId: "manual-own", path: "/srv/harness/users/u1/manual", sessionIds: [] },
        { workspaceId: "space-b", path: "/srv/harness/users/u2/space-b", sessionIds: ["session-foreign"] },
      ],
      archivedSessionIds: ["session-own", "session-ungrouped", "session-foreign"],
    }) as { items: Array<{ workspaceId: string; sessionIds: string[] }>; archivedSessionIds: string[] };

    expect(value.items).toEqual([
      { workspaceId: "space-a", path: ownPath, sessionIds: ["session-own"] },
      { workspaceId: "manual-own", path: "/srv/harness/users/u1/manual", sessionIds: [] },
    ]);
    // An ungrouped descendant remains part of the account's archive set even
    // though it is not attached to a visible Workspace row.
    expect(value.archivedSessionIds).toEqual(["session-own", "session-ungrouped"]);
  });

  it("allows root and every own descendant while rejecting an outside path", () => {
    const value = projectSessionListValue(scope, {
      items: [
        { sessionId: "session-own", cwd: "/srv/harness/users/u1" },
        { sessionId: "session-ungrouped", cwd: `${ownPath}/worktree-1` },
        { sessionId: "session-sibling", cwd: "/srv/harness/users/u1/space-a-other" },
        { sessionId: "session-foreign", cwd: "/srv/elsewhere" },
      ],
    }) as { items: Array<{ sessionId: string }> };

    expect(value.items.map(item => item.sessionId)).toEqual(["session-own", "session-ungrouped", "session-sibling"]);
  });

  it("filters content-search snippets by the authenticated session account", () => {
    const value = projectSessionSearchValue(scope, {
      items: [
        { sessionId: "session-foreign", snippet: "private foreign text" },
        { sessionId: "session-own", snippet: "own text" },
        { sessionId: "session-ungrouped", snippet: "own ungrouped text" },
      ],
      hasMore: true,
    }) as { items: Array<{ sessionId: string; snippet: string }>; hasMore: boolean };

    expect(value.items).toEqual([
      { sessionId: "session-own", snippet: "own text" },
      { sessionId: "session-ungrouped", snippet: "own ungrouped text" },
    ]);
    expect(value.hasMore).toBe(true);
  });
});
