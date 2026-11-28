// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRouteWithContext, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HANDOFF_CLAIM_STORAGE_KEY } from "../features/account/handoff-session";
import { LanguageProvider } from "../shared/i18n";
import { Route } from "./claim.$code";

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

vi.mock("../features/nodes/node-icon", () => ({ NodeIcon: () => null }));

const CODE = "claim-code-1";
const methods = {
  githubOAuthEnabled: false,
  googleOAuthEnabled: false,
  discordOAuthEnabled: false,
  passwordAuthEnabled: true,
  emailAuthEnabled: false,
  guestAuthEnabled: true,
};
const human = { id: "human-1", username: "olivia", displayName: "Olivia", avatarUrl: null, kind: "human" };
const agentSummary = { id: "agent-1", username: "claude-code-7f3k", displayName: "Claude Code · 7f3k", files: 1, spaceId: "space-1", stopped: false };
const handoff = {
  claimed: false,
  agent: agentSummary,
  expiresAt: "2026-12-03T00:00:00.000Z",
  spaces: [{ id: "space-1", type: "personal", name: "Personal", files: 1 }],
};

let signedIn = false;
let nodeError = false;
let container: HTMLDivElement;
let root: Root;
const assign = vi.fn();
const replace = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Request", http.Request);
  vi.stubGlobal("fetch", http.fetch);
  vi.stubGlobal("location", { ...window.location, assign, replace });
  window.localStorage.setItem("univer-workspace-language", "en-US");
  window.sessionStorage.clear();
  signedIn = false;
  nodeError = false;
  assign.mockClear();
  replace.mockClear();
  http.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/session") {
      return Response.json(signedIn
        ? { authenticated: true, ...methods, user: human, authenticationMethods: { password: true, email: null, externalIdentities: [] } }
        : { authenticated: false, ...methods });
    }
    if (request.method === "GET" && url.pathname === "/api/agents/claim") {
      return Response.json(handoff);
    }
    if (request.method === "GET" && url.pathname === "/api/nodes/node-1") {
      return nodeError
        ? Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 })
        : Response.json({ node: { id: "node-1", name: "Report.univer.html" } });
    }
    if (request.method === "GET" && url.pathname === "/api/spaces/space-1/nodes") {
      return Response.json({ nodes: [] });
    }
    if (request.method === "POST" && url.pathname === "/api/agents/claim") {
      return Response.json({ agent: agentSummary });
    }
    throw new Error(`Unexpected request ${request.method} ${url.pathname}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function open(entry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const parent = createRootRouteWithContext<{ queryClient: QueryClient }>()();
  Object.assign(Route.options, { getParentRoute: () => parent, path: "/claim/$code" });
  const pages = ["/spaces/$spaceId", "/nodes/$nodeId", "/login"].map((path) => createRoute({ getParentRoute: () => parent, path, component: () => path }));
  const router = createRouter({
    routeTree: parent.addChildren([Route, ...pages]),
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [entry] }),
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

describe("/claim/$code?to=... direct landing", () => {
  it("persists sessionStorage and redirects signed-out visitors when node target is readable", async () => {
    const target = "/nodes/node-1?view=immersive#chart";
    await open(`/claim/${CODE}?to=${encodeURIComponent(target)}`);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(target));
    expect(window.sessionStorage.getItem(HANDOFF_CLAIM_STORAGE_KEY)).toBe(JSON.stringify({ code: CODE }));
  });

  it("stays on claim card without looping if node target is unreadable", async () => {
    nodeError = true;
    const target = "/nodes/node-1?view=immersive";
    await open(`/claim/${CODE}?to=${encodeURIComponent(target)}`);
    await waitFor(() => expect(container.textContent).toContain("Sign in and take it"));
    expect(replace).not.toHaveBeenCalled();
    const link = container.querySelector("a[href^='/login']");
    const expectedClaimPath = `/claim/${CODE}?to=${encodeURIComponent(target)}`;
    expect(link?.getAttribute("href")).toBe(`/login?returnTo=${encodeURIComponent(expectedClaimPath)}`);
  });

  it("redirects signed-out visitors directly when space target is in handoff spaces", async () => {
    const target = "/spaces/space-1?view=files";
    await open(`/claim/${CODE}?to=${encodeURIComponent(target)}`);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(target));
  });

  it("clears sessionStorage and navigates to target via location.assign after authenticated claim", async () => {
    signedIn = true;
    window.sessionStorage.setItem(HANDOFF_CLAIM_STORAGE_KEY, JSON.stringify({ code: CODE }));
    const target = "/nodes/node-1?view=immersive#chart";
    await open(`/claim/${CODE}?to=${encodeURIComponent(target)}`);
    await waitFor(() => expect(container.textContent).toContain("Take it"));
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Take it");
    await act(async () => { button?.click(); });
    await waitFor(() => expect(assign).toHaveBeenCalledWith(target));
    expect(window.sessionStorage.getItem(HANDOFF_CLAIM_STORAGE_KEY)).toBeNull();
  });
});
