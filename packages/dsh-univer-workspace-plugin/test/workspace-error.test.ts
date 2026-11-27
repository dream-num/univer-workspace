import { describe, expect, it } from "vitest";
import { workspaceErrorMessage } from "../src/client/workspace-error.ts";

const origin = "https://workspace.example";

describe("Workspace error message", () => {
  it("shows the server's message and the confirm link on the Workspace origin", () => {
    const body = { error: { code: "INTERACTIVE_SESSION_REQUIRED", message: "Sharing a file needs a person.", url: "/confirm/grant?node=n1&user=u1&role=viewer" } };
    expect(workspaceErrorMessage(body, 403, origin)).toBe(
      "Sharing a file needs a person. Confirm it in Workspace: https://workspace.example/confirm/grant?node=n1&user=u1&role=viewer",
    );
  });

  it("drops a link that leaves the Workspace origin or arrives before the origin is known", () => {
    const body = { error: { message: "Refused.", url: "https://elsewhere.example/confirm/public?space=s1" } };
    expect(workspaceErrorMessage(body, 403, origin)).toBe("Refused.");
    expect(workspaceErrorMessage({ error: { message: "Refused.", url: "/confirm/public?space=s1" } }, 403, "")).toBe("Refused.");
  });

  it("keeps the plugin's string errors and falls back to the status", () => {
    expect(workspaceErrorMessage({ error: "workspace_connection_required" }, 502, origin)).toBe("workspace_connection_required");
    expect(workspaceErrorMessage(undefined, 500, origin)).toBe("Workspace request failed (500)");
  });
});
