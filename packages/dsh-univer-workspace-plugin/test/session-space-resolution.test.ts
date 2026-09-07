import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import { apply } from "../src/provider/service-provider.ts";
import { originUserDirectoryPath } from "../src/provider/workspace-contract.ts";

const origin = "https://workspace.example";
const root = "/tmp/session-space-test";
const accountPath = originUserDirectoryPath(root, origin, "user-1");

function setup(path = accountPath, record?: { userId: string; spaceId: string; origin?: string }) {
  const ctx = new Context();
  const request = vi.fn(async () => Response.json({ spaces: [
    { id: "team", name: "Team", type: "team", accessRole: "owner" },
    { id: "personal", name: "Personal", type: "personal", accessRole: "owner" },
  ] }));
  ctx.provide("workspaceAuth", {
    currentIdentity: () => ({ userId: "user-1", username: "alice" }),
    effectiveOrigin: () => origin,
    currentClient: () => ({ origin, sessionToken: "test", request }),
  });
  ctx.provide("workspaceRegistry", { resolveByPath: async () => ({ id: "workspace", path }) });
  ctx.provide("storageDomain", {
    open: async () => ({ table: () => ({ get: () => record }), close: async () => {} }),
  });
  apply(ctx, { workspaceRoot: root, workerUrl: new URL("file:///unused-worker.js"), license: "" });
  return { request, service: ctx.get("univerWorkspace")! };
}

describe("Session default Space resolution", () => {
  it("uses the personal Space for a verified account directory without a Space link", async () => {
    const { service, request } = setup();
    await expect(service.resolveSpaceForSession(accountPath)).resolves.toEqual({ userId: "user-1", spaceId: "personal" });
    expect(request).toHaveBeenCalledWith("/api/spaces");
  });

  it.each([
    "/tmp/unrelated",
    originUserDirectoryPath(root, origin, "other-user"),
    originUserDirectoryPath(root, "https://other.example", "user-1"),
    `${accountPath}/unlinked-child`,
  ])("does not assign the account to an unrelated workspace: %s", async (path) => {
    const { service, request } = setup(path);
    await expect(service.resolveSpaceForSession(path)).resolves.toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps a selected Space as the default", async () => {
    const { service, request } = setup(`${accountPath}/team`, { userId: "user-1", spaceId: "selected", origin });
    await expect(service.resolveSpaceForSession(`${accountPath}/team`)).resolves.toEqual({ userId: "user-1", spaceId: "selected" });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    { userId: "other-user", spaceId: "selected", origin },
    { userId: "user-1", spaceId: "selected", origin: "https://other.example" },
  ])("rejects a link owned by another connection", async (record) => {
    const { service } = setup(accountPath, record);
    await expect(service.resolveSpaceForSession(accountPath)).resolves.toBeUndefined();
  });

  it("does not choose a team when no owned personal Space is returned", async () => {
    const { service, request } = setup();
    request.mockResolvedValue(Response.json({ spaces: [{ id: "team", name: "Team", type: "team", accessRole: "owner" }] }));
    await expect(service.resolveSpaceForSession(accountPath)).resolves.toBeUndefined();
  });
});
