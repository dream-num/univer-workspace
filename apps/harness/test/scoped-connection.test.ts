import { describe, expect, it } from "vitest";
import { projectDownlinkFrame } from "../src/scoped-connection.js";
import type { Scope } from "../src/scoped-api.js";

const scope: Scope = {
  sessionRootPath: "/srv/harness/users/u1",
  workspaceIds: new Set(["workspace-own"]),
  workspacePaths: new Set(["/srv/harness/users/u1/space"]),
  sessionIds: new Set(["session-own"]),
  agentPresetIds: new Set(["standard"]),
  defaultAgentPresetId: "standard",
  sessionCwds: new Map([["session-created", "/srv/harness/users/u1/new-session"]]),
  workspacePathById: new Map([["workspace-own", "/srv/harness/users/u1/space"]]),
  workspaceSessionsById: new Map([["workspace-own", new Set(["session-own"])]]),
};

function frame(payload: Record<string, unknown>): any {
  return { rpcId: "rpc-1", payload };
}

describe("authenticated DSH downlink projection", () => {
  it("drops foreign sessions and process-global remote events", () => {
    const pending = new Map<string, { sessionId: string; expiresAt: number }>();
    expect(projectDownlinkFrame(scope, frame({ type: "session/subscribed", sessionId: "foreign" }), pending)).toBeUndefined();
    expect(projectDownlinkFrame(scope, frame({ type: "host/remote-event", event: "secret", args: ["value"] }), pending)).toBeUndefined();
  });

  it("filters foreign memberships from an own workspace frame", () => {
    const pending = new Map<string, { sessionId: string; expiresAt: number }>();
    const result = projectDownlinkFrame(scope, frame({
      type: "host/workspace-changed",
      workspace: {
        workspaceId: "workspace-own",
        path: "/srv/harness/users/u1/space",
        sessionIds: ["session-own", "foreign"],
      },
    }), pending) as any;
    expect(result.payload.workspace.sessionIds).toEqual(["session-own"]);
  });

  it("keeps the first event for a newly-created own session before host/session-added", () => {
    const pending = new Map<string, { sessionId: string; expiresAt: number }>();
    expect(projectDownlinkFrame(scope, frame({ type: "session/event", sessionId: "session-created", event: "turn/start" }), pending)).toBeDefined();
  });

  it("redacts stream diagnostics while preserving reconnect semantics", () => {
    const pending = new Map<string, { sessionId: string; expiresAt: number }>();
    const result = projectDownlinkFrame(scope, frame({
      type: "stream/error",
      error: { code: "internal", message: "/root/other-user/private", details: { path: "/root" } },
    }), pending) as any;
    expect(result.payload).toEqual({
      type: "stream/error",
      error: { code: "internal", message: "connection stream unavailable", details: {} },
    });
  });

  it("records only account-local approval requests for response ACL", () => {
    const pending = new Map<string, { sessionId: string; expiresAt: number }>();
    expect(projectDownlinkFrame(scope, frame({ type: "approval/requested", sessionId: "foreign" }), pending)).toBeUndefined();
    expect(projectDownlinkFrame(scope, frame({ type: "approval/requested", sessionId: "session-own" }), pending)).toBeDefined();
    expect(pending.get("rpc-1")?.sessionId).toBe("session-own");
  });
});
