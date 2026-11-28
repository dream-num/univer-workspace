import { describe, expect, it, vi } from "vitest";
import { WorkspaceHttp, WorkspaceSpaceFeature } from "../src/index.js";
import { createClaimLink, resolveClaimTarget } from "../src/product.js";

function mockSpaces(
  handler: (call: { readonly method: string; readonly path: string }) => Response,
) {
  const calls: Array<{ readonly method: string; readonly path: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const call = { method: request.method, path: url.pathname + url.search };
    calls.push(call);
    return handler(call);
  };
  const http = new WorkspaceHttp({
    cookie: "workspace_session=test",
    fetcher,
    origin: "https://workspace.test",
    role: "client",
  });
  return { calls, spaces: new WorkspaceSpaceFeature(async () => http) };
}

describe("claim links and target resolution", () => {
  const origin = "https://workspace.test";

  it("creates a bare claim link when options are omitted", async () => {
    const { spaces, calls } = mockSpaces(() =>
      Response.json({ claimUrl: "/claim/code-1", expiresIn: 600 }),
    );
    const link = await createClaimLink(spaces, origin);
    expect(link.claimUrl).toBe("https://workspace.test/claim/code-1");
    expect(Number.isNaN(Date.parse(link.expiresAt))).toBe(false);
    expect(calls).toEqual([{ method: "POST", path: "/api/agents/claim-codes" }]);
  });

  it.each([
    "/nodes/n1",
    "/nodes/node%2F1?view=immersive",
    "/spaces/s1",
    "/spaces/s1/pulls/3#files",
  ])("attaches validated claim target %s", async (to) => {
    const { spaces } = mockSpaces(() =>
      Response.json({ claimUrl: "/claim/code-2", expiresIn: 300 }),
    );
    const link = await createClaimLink(spaces, origin, { to });
    expect(new URL(link.claimUrl).pathname).toBe("/claim/code-2");
    expect(new URL(link.claimUrl).searchParams.get("to")).toBe(to);
  });

  it.each([
    "",
    "/login",
    "/claim/other",
    "//evil.test/nodes/n1",
    "https://evil.test/nodes/n1",
    "https://workspace.test/nodes/n1",
    "/nodes/../login",
    "/spaces/../secret",
  ])("rejects invalid claim target %j without creating a claim code", async (to) => {
    const createAgentClaimCode = vi.fn();
    await expect(createClaimLink({ createAgentClaimCode }, origin, { to })).rejects.toMatchObject({
      code: "workspace-argument-invalid",
      message: "Claim target must be a /nodes/ or /spaces/ path.",
    });
    expect(createAgentClaimCode).not.toHaveBeenCalled();
  });

  it.each([
    { node: "n1", name: "Budget.xlsx", immersive: undefined, expected: "/nodes/n1" },
    { node: "n1", name: "Dashboard.univer.html", immersive: undefined, expected: "/nodes/n1?view=immersive" },
    { node: "n1", name: "Dashboard.UNIVER.HTML", immersive: undefined, expected: "/nodes/n1?view=immersive" },
    { node: `${origin}/nodes/n1`, name: "Budget.xlsx", immersive: undefined, expected: "/nodes/n1" },
    { node: `${origin}/nodes/n1?view=immersive`, name: "Budget.xlsx", immersive: undefined, expected: "/nodes/n1?view=immersive" },
    { node: "n1", name: "Budget.xlsx", immersive: true, expected: "/nodes/n1?view=immersive" },
    { node: "n1", name: "Dashboard.univer.html", immersive: false, expected: "/nodes/n1" },
    { node: `${origin}/nodes/n1?view=immersive`, name: "Dashboard.univer.html", immersive: false, expected: "/nodes/n1" },
    { node: "node/1", name: "Dashboard.univer.html", immersive: undefined, expected: "/nodes/node%2F1?view=immersive" },
  ])("resolves claim target for $node ($name, immersive=$immersive)", async ({ node, name, immersive, expected }) => {
    const id = node.startsWith("http") ? "n1" : node;
    const { spaces } = mockSpaces(() =>
      Response.json({
        node: {
          id,
          spaceId: "s1",
          parentNodeId: null,
          name,
          hasChildren: false,
          accessRole: "owner",
          updatedAt: "2026-11-14T00:00:00.000Z",
          resource: null,
          capabilities: { browseChildren: false, createChildren: false, move: true, rename: true, share: true, trash: true },
        },
        space: { id: "s1", name: "Team" },
        breadcrumbs: [{ id, name }],
        navigationRootNodeId: null,
      }),
    );
    await expect(
      resolveClaimTarget(spaces, origin, { node, ...(immersive === undefined ? {} : { immersive }) }),
    ).resolves.toBe(expected);
  });

  it("rejects cross-origin URLs when resolving a claim target", async () => {
    const { spaces, calls } = mockSpaces(() => {
      throw new Error("Unexpected request");
    });
    await expect(
      resolveClaimTarget(spaces, origin, { node: "https://other.test/nodes/n1" }),
    ).rejects.toMatchObject({ code: "workspace-origin-mismatch" });
    expect(calls).toEqual([]);
  });
});
