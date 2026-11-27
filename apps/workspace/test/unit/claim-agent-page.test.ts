// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRouteWithContext, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../web/src/shared/i18n";
import { Route } from "../../web/src/routes/claim.$code";

const http = vi.hoisted(() => {
  const NativeRequest = globalThis.Request;
  vi.stubGlobal("Request", class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  return { fetch, Request: globalThis.Request };
});

vi.mock("../../web/src/features/nodes/node-icon", () => ({ NodeIcon: () => null }));

const CODE = "claim-code-1";
const methods = { githubOAuthEnabled: false, googleOAuthEnabled: false, discordOAuthEnabled: false, passwordAuthEnabled: true, emailAuthEnabled: false, guestAuthEnabled: true };
const people = {
  agent: { id: "agent-1", username: "claude-code-7f3k", displayName: "Claude Code · 7f3k", avatarUrl: null, kind: "agent", claimed: false },
  human: { id: "human-1", username: "olivia", displayName: "Olivia", avatarUrl: null, kind: "human" },
};
const agentSummary = { id: "agent-1", username: "claude-code-7f3k", displayName: "Claude Code · 7f3k", files: 1, spaceId: "space-1", stopped: false };
const handoff = {
  claimed: false, agent: agentSummary, expiresAt: "2026-12-03T00:00:00.000Z",
  spaces: [{ id: "space-1", type: "personal", name: "Claude Code 的个人空间", files: 1 }, { id: "space-2", type: "team", name: "Research", files: 0 }],
};
const files: Record<string, unknown[]> = {
  "space-1": [{ id: "node-1", name: "Budget", resource: { kind: "univer", unitType: "sheet" } }, { id: "node-2", name: "Report.univer.html", resource: { kind: "blob", mediaType: "text/html" } }],
  "space-2": [],
};
let signedIn: keyof typeof people | null;
const requests: string[] = [];
const assign = vi.fn();
let container: HTMLDivElement;
let root: Root;

function session() {
  return signedIn === null
    ? { authenticated: false, ...methods }
    : { authenticated: true, ...methods, user: people[signedIn], authenticationMethods: { password: true, email: null, externalIdentities: [] } };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Request", http.Request);
  vi.stubGlobal("fetch", http.fetch);
  vi.stubGlobal("location", { ...window.location, assign });
  window.localStorage.setItem("univer-workspace-language", "en-US");
  requests.length = 0;
  assign.mockClear();
  http.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    requests.push(`${request.method} ${url.pathname}`);
    if (request.method === "GET" && url.pathname === "/api/session") return Response.json(session());
    if (request.method === "GET" && url.pathname === "/api/agents/claim") {
      expect(url.searchParams.get("code")).toBe(CODE);
      return Response.json(handoff);
    }
    const spaceId = /^\/api\/spaces\/([^/]+)\/nodes$/u.exec(url.pathname)?.[1];
    if (request.method === "GET" && spaceId) return Response.json({ nodes: files[spaceId] });
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      signedIn = null;
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && url.pathname === "/api/agents/claim") {
      expect(await request.json()).toEqual({ code: CODE });
      return Response.json({ agent: agentSummary });
    }
    throw new Error(`Unexpected request ${request.method} ${url.pathname}`);
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.unstubAllGlobals();
});

async function open() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const parent = createRootRouteWithContext<{ queryClient: QueryClient }>()();
  Object.assign(Route.options, { getParentRoute: () => parent, path: "/claim/$code" });
  const pages = ["/spaces/$spaceId", "/nodes/$nodeId", "/login"].map((path) => createRoute({ getParentRoute: () => parent, path, component: () => path }));
  const router = createRouter({
    routeTree: parent.addChildren([Route, ...pages]), context: { queryClient },
    history: createMemoryHistory({ initialEntries: [`/claim/${CODE}`] }),
  });
  await act(async () => {
    await router.load();
    root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(LanguageProvider, null, createElement(RouterProvider, { router }))));
  });
  return router;
}
async function waitFor(check: () => void) {
  for (let attempt = 0; ; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    try { check(); return; } catch (error) { if (attempt === 99) throw error; }
  }
}
function button(name: string) {
  return [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === name);
}
async function click(name: string) {
  await act(async () => button(name)!.click());
}
function links() {
  return Object.fromEntries([...container.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]));
}

it("shows a visitor who is not signed in the agent's Spaces and files, with one way to take it", async () => {
  signedIn = null;
  await open();
  await waitFor(() => expect(links()).toHaveProperty("Budget"));
  expect(container.textContent).toContain("Work from Claude Code · 7f3k");
  expect(links()).toEqual({
    "Personal space": "/spaces/space-1", "Budget": "/nodes/node-1", "Report.univer.html": "/nodes/node-2?view=immersive", "Research": "/spaces/space-2",
    "Sign in and take it": `/login?returnTo=%2Fclaim%2F${CODE}`,
  });
  expect(container.querySelectorAll("button")).toHaveLength(0);
});

it("lets a browser signed in as an agent sign out and read on the same handoff link", async () => {
  signedIn = "agent";
  const router = await open();
  await waitFor(() => expect(container.textContent).toContain("An agent cannot take an agent."));
  expect(links()).toEqual({});
  expect(button("Take it")).toBeUndefined();

  await click("Sign out and continue");
  await waitFor(() => expect(links()).toHaveProperty("Sign in and take it"));
  expect(requests).toContain("POST /api/auth/logout");
  expect(router.state.location.pathname).toBe(`/claim/${CODE}`);
});

it("gives a signed-in person the summary without its files, and the agent in one click", async () => {
  signedIn = "human";
  const router = await open();
  await waitFor(() => expect(button("Take it")).toBeDefined());
  expect(container.textContent).toContain("The agent will belong to “Olivia”.");
  expect(container.textContent).toContain("Research");
  expect(links()).toEqual({});
  expect(requests).not.toContain("GET /api/spaces/space-1/nodes");
  await click("Take it");
  await waitFor(() => expect(router.state.location.pathname).toBe("/spaces/space-1"));
  expect(requests).toContain("POST /api/agents/claim");
});

it("tells a session the server refuses to take the agent to sign out", async () => {
  signedIn = "human";
  await open();
  await waitFor(() => expect(button("Take it")).toBeDefined());
  http.fetch.mockImplementationOnce(async () =>
    Response.json({ error: { code: "INTERACTIVE_SESSION_REQUIRED", message: "This action needs a person signed in to Workspace in a browser." } }, { status: 403 }));
  await click("Take it");
  await waitFor(() => expect(button("Sign out and continue")).toBeDefined());
  expect(container.textContent).toContain("An agent cannot take an agent.");
});

it("offers sign-in when the agent has an owner, and only the way home when the link itself is the problem", async () => {
  signedIn = null;
  http.fetch.mockImplementationOnce(async () => Response.json(session()));
  http.fetch.mockImplementationOnce(async () =>
    Response.json({ error: { code: "AGENT_ALREADY_CLAIMED", message: "This agent already has an owner." } }, { status: 409 }));
  await open();
  await waitFor(() => expect(container.textContent).toContain("If you took it, sign in to open its files."));
  expect(links()).toEqual({ "Sign in": `/login?returnTo=%2Fclaim%2F${CODE}` });
  await act(async () => root.unmount());
  root = createRoot(container);

  http.fetch.mockImplementationOnce(async () => Response.json(session()));
  http.fetch.mockImplementationOnce(async () =>
    Response.json({ error: { code: "AGENT_CLAIM_EXPIRED", message: "This handoff link has expired." } }, { status: 410 }));
  await open();
  await waitFor(() => expect(container.textContent).toContain("This handoff link has expired."));
  expect(button("Back to home")).toBeDefined();
  expect(links()).toEqual({});
});
