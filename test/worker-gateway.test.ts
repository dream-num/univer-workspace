import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createMockD1 } from "./mock-d1.ts";

function dataModule(source: string) {
  return {
    url: "data:text/javascript," + encodeURIComponent(source),
    shortCircuit: true
  };
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("cloudflare:")) {
      return dataModule(`
        export default {};
        export class DurableObject {
          constructor(ctx, env) {
            this.ctx = ctx;
            this.env = env;
          }
        };
        export class WorkerEntrypoint {};
      `);
    }
    return nextResolve(specifier, context);
  }
});

function createMockEnv() {
  const d1 = createMockD1();

  const mockChatAgent: any = {
    idFromName: (name: string) => ({ toString: () => `id_${name}`, name }),
    get: (id: any) => ({
      fetch: async (req: Request) => {
        const url = new URL(req.url);
        if (url.pathname === "/api/health") {
          return new Response(JSON.stringify({ status: "healthy", id: id.toString() }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response("ChatAgent response", { status: 200 });
      }
    })
  };

  const mockWorkspaceDO: any = {
    idFromName: (name: string) => ({ toString: () => `ws_${name}`, name }),
    get: (_id: any) => ({
      fetch: async (req: Request) => {
        const url = new URL(req.url);
        if (url.pathname.includes("/live")) {
          return new Response(JSON.stringify({ status: "connected" }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response("WorkspaceDO response", { status: 200 });
      }
    })
  };

  return {
    DB: d1,
    ChatAgent: mockChatAgent,
    WorkspaceDO: mockWorkspaceDO
  };
}

describe("Master Cloudflare Worker Edge Gateway", async () => {
  const { default: worker } = await import("../src/server.ts");

  test("serves healthz with CORS headers", async () => {
    const env = createMockEnv();
    const req = new Request("https://workspace.edge/healthz", {
      headers: { Origin: "http://localhost:3000" }
    });
    const res = await worker.fetch(req, env as any, {} as any);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");

    const data = await res.json();
    assert.equal(data.status, "ok");
  });

  test("handles unauthenticated and authenticated sessions and space workflows", async () => {
    const env = createMockEnv();

    // 1. Check anonymous session
    const sessionReq1 = new Request("https://workspace.edge/api/session");
    const sessionRes1 = await worker.fetch(sessionReq1, env as any, {} as any);
    assert.equal(sessionRes1.status, 200);
    const sessionData1 = await sessionRes1.json();
    assert.equal(sessionData1.authenticated, false);

    // 2. Register new user
    const registerReq = new Request("https://workspace.edge/api/auth/password/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "carol",
        displayName: "Carol Designer",
        password: "supersecretcarol"
      })
    });
    const registerRes = await worker.fetch(registerReq, env as any, {} as any);
    assert.equal(registerRes.status, 200);
    const setCookie = registerRes.headers.get("Set-Cookie");
    assert.ok(setCookie, "Response must include Set-Cookie header");

    const cookieMatch = setCookie.match(/workspace_session=([^;]+)/);
    assert.ok(cookieMatch, "workspace_session cookie must be present");
    const sessionCookie = `workspace_session=${cookieMatch[1]}`;

    // 3. Verify session now authenticated
    const sessionReq2 = new Request("https://workspace.edge/api/session", {
      headers: { Cookie: sessionCookie }
    });
    const sessionRes2 = await worker.fetch(sessionReq2, env as any, {} as any);
    assert.equal(sessionRes2.status, 200);
    const sessionData2 = await sessionRes2.json();
    assert.equal(sessionData2.authenticated, true);
    assert.equal(sessionData2.user.username, "carol");

    // 4. List spaces
    const spacesReq = new Request("https://workspace.edge/api/spaces", {
      headers: { Cookie: sessionCookie }
    });
    const spacesRes = await worker.fetch(spacesReq, env as any, {} as any);
    assert.equal(spacesRes.status, 200);
    const spacesData = await spacesRes.json();
    assert.ok(spacesData.spaces.length >= 1);
    const personalSpaceId = spacesData.spaces[0].id;

    // 5. Create Sheet Resource in personal space
    const createResReq = new Request("https://workspace.edge/api/resources", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie
      },
      body: JSON.stringify({
        spaceId: personalSpaceId,
        name: "Financial Forecast 2027",
        unitType: "sheet"
      })
    });
    const createResRes = await worker.fetch(createResReq, env as any, {} as any);
    assert.equal(createResRes.status, 200);
    const newResource = await createResRes.json();
    assert.equal(newResource.resource.kind, "univer");
    assert.equal(newResource.resource.univer.unit_type, "sheet");

    const nodeId = newResource.node.id;
    const nodeReq = new Request(`https://workspace.edge/api/nodes/${nodeId}`, {
      headers: { Cookie: sessionCookie }
    });
    const nodeRes = await worker.fetch(nodeReq, env as any, {} as any);
    assert.equal(nodeRes.status, 200);
    const nodeData = await nodeRes.json();
    assert.equal(nodeData.node.id, nodeId);
    assert.equal(nodeData.node.resource.kind, "univer");
    assert.ok(nodeData.space.id);
    assert.ok(Array.isArray(nodeData.breadcrumbs));

    const openReq = new Request(
      `https://workspace.edge/api/resources/${newResource.resource.id}/open`,
      { method: "POST", headers: { Cookie: sessionCookie } }
    );
    const openRes = await worker.fetch(openReq, env as any, {} as any);
    assert.equal(openRes.status, 200);
    const openData = await openRes.json();
    assert.equal(openData.resource.kind, "univer");
    assert.equal(openData.resource.editorMode, "edit");
    assert.ok(openData.resource.unitId);

    // 6. List root nodes of personal space
    const nodesReq = new Request(`https://workspace.edge/api/spaces/${personalSpaceId}/nodes`, {
      headers: { Cookie: sessionCookie }
    });
    const nodesRes = await worker.fetch(nodesReq, env as any, {} as any);
    assert.equal(nodesRes.status, 200);
    const nodesData = await nodesRes.json();
    assert.ok(nodesData.nodes.length >= 1);
    assert.equal(nodesData.nodes[0].name, "Financial Forecast 2027");

    // 6a. Test Views: owned-by-me
    const ownedReq = new Request("https://workspace.edge/api/owned-by-me", {
      headers: { Cookie: sessionCookie }
    });
    const ownedRes = await worker.fetch(ownedReq, env as any, {} as any);
    assert.equal(ownedRes.status, 200);
    assert.equal(ownedRes.headers.get("Content-Type")?.includes("application/json"), true);
    const ownedData = await ownedRes.json();
    assert.ok(Array.isArray(ownedData.items));
    assert.equal(ownedData.items.length >= 1, true);
    assert.equal(ownedData.items[0].node.name, "Financial Forecast 2027");
    assert.equal(ownedData.items[0].resource.kind, "univer");
    assert.ok(ownedData.items[0].location.space);

    // 6b. Test Views: recent-resources
    const recentReq = new Request("https://workspace.edge/api/recent-resources", {
      headers: { Cookie: sessionCookie }
    });
    const recentRes = await worker.fetch(recentReq, env as any, {} as any);
    assert.equal(recentRes.status, 200);
    assert.equal(recentRes.headers.get("Content-Type")?.includes("application/json"), true);
    const recentData = await recentRes.json();
    assert.ok(Array.isArray(recentData.items));

    // 6c. Test Views: shared-with-me
    const sharedReq = new Request("https://workspace.edge/api/shared-with-me", {
      headers: { Cookie: sessionCookie }
    });
    const sharedRes = await worker.fetch(sharedReq, env as any, {} as any);
    assert.equal(sharedRes.status, 200);
    assert.equal(sharedRes.headers.get("Content-Type")?.includes("application/json"), true);
    const sharedData = await sharedRes.json();
    assert.ok(Array.isArray(sharedData.items));

    // 6d. Unknown API route returns JSON 404
    const unknownReq = new Request("https://workspace.edge/api/non-existent-endpoint", {
      headers: { Cookie: sessionCookie }
    });
    const unknownRes = await worker.fetch(unknownReq, env as any, {} as any);
    assert.equal(unknownRes.status, 404);
    assert.equal(unknownRes.headers.get("Content-Type")?.includes("application/json"), true);
    const unknownData = await unknownRes.json();
    assert.ok(unknownData.error);

    // 6e. Test Worktrees: active list
    const wtReq = new Request("https://workspace.edge/api/worktrees?scope=active", {
      headers: { Cookie: sessionCookie }
    });
    const wtRes = await worker.fetch(wtReq, env as any, {} as any);
    assert.equal(wtRes.status, 200);
    assert.equal(wtRes.headers.get("Content-Type")?.includes("application/json"), true);
    const wtData = await wtRes.json();
    assert.ok(Array.isArray(wtData.items));

    // 7. Logout
    const logoutReq = new Request("https://workspace.edge/api/auth/logout", {
      method: "POST",
      headers: { Cookie: sessionCookie }
    });
    const logoutRes = await worker.fetch(logoutReq, env as any, {} as any);
    assert.equal(logoutRes.status, 200);

    // 8. Verify session invalidated after logout
    const sessionReq3 = new Request("https://workspace.edge/api/session", {
      headers: { Cookie: sessionCookie }
    });
    const sessionRes3 = await worker.fetch(sessionReq3, env as any, {} as any);
    const sessionData3 = await sessionRes3.json();
    assert.equal(sessionData3.authenticated, false);
  });

  test("routes realtime ChatAgent and WorkspaceDO endpoints", async () => {
    const env = createMockEnv();

    // ChatAgent DO dispatch
    const chatAgentReq = new Request("https://workspace.edge/api/health?docId=doc_123");
    const chatAgentRes = await worker.fetch(chatAgentReq, env as any, {} as any);
    assert.equal(chatAgentRes.status, 200);
    const chatAgentData = await chatAgentRes.json();
    assert.equal(chatAgentData.status, "healthy");

    // WorkspaceDO dispatch
    const wsReq = new Request("https://workspace.edge/spaces/space_main/live");
    const wsRes = await worker.fetch(wsReq, env as any, {} as any);
    assert.equal(wsRes.status, 200);
    const wsData = await wsRes.json();
    assert.equal(wsData.status, "connected");
  });
});
