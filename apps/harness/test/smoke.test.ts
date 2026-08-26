import { describe, expect, it } from "vitest";
import * as host from "../src/index.js";
import { parseSessionCookie, signSessionCookie } from "../src/auth.js";
import {
  workspacePathFor, isDirectSha256Child, workspacePathName,
  spaceDirectoryPath, isUserScopedPath,
} from "../src/identity.js";
import { emptyUwhState, stateKeyFor } from "../src/contract.js";
import { readLocalState, writeLocalState, recordCreatedSession, recordTemplateFork, templateForkOf } from "../src/client/local-state.js";

describe("univer-workspace-harness plugin", () => {
  it("exports a loadable cordis host plugin", () => {
    expect(host.name).toBe("univer-workspace-harness");
    expect(typeof host.apply).toBe("function");
  });

  it("round-trips the signed session cookie", () => {
    const identity = { userId: "u-1", username: "alice", displayName: "Alice" };
    const cookie = signSessionCookie(identity, "secret", 60_000);
    expect(parseSessionCookie(cookie, "secret")).toMatchObject(identity);
    expect(parseSessionCookie(cookie, "wrong")).toBeUndefined();
  });

  it("derives a direct SHA-256-named workspace path", () => {
    const derived = workspacePathFor("/root", "u-1");
    expect(derived.ok).toBe(true);
    if (derived.ok) {
      expect(isDirectSha256Child("/root", derived.path)).toBe(true);
      expect(workspacePathName("u-1")).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("scopes a per-Space directory under the user directory", () => {
    const spaceDir = spaceDirectoryPath("/root", "u-1", "sp-1");
    expect(isUserScopedPath("/root", "u-1", spaceDir)).toBe(true);
    expect(isUserScopedPath("/root", "u-2", spaceDir)).toBe(false);
    expect(isUserScopedPath("/root", "u-1", "/root/elsewhere")).toBe(false);
    // The user directory itself is in scope (template-fork container).
    expect(isUserScopedPath("/root", "u-1", workspacePathFor("/root", "u-1").ok ? (workspacePathFor("/root", "u-1") as { path: string }).path : "")).toBe(true);
  });

  it("partitions browser-local state by user", () => {
    const storage = new Map<string, string>();
    const like = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    };
    expect(readLocalState(like, "u-1")).toEqual(emptyUwhState());
    let state = recordCreatedSession(emptyUwhState(), "s-1");
    state = recordTemplateFork(state, "tpl", "s-2");
    writeLocalState(like, "u-1", state);
    const restored = readLocalState(like, "u-1");
    expect(restored.createdSessionIds).toEqual(["s-2", "s-1"]);
    expect(templateForkOf(restored, "tpl")).toBe("s-2");
    expect(stateKeyFor("u-1")).toContain("u-1");
  });
});
