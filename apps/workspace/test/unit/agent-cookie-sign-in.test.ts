// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRouteWithContext, createRouter, RouterProvider, type AnyRoute } from "@tanstack/react-router";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../web/src/shared/i18n";
import { Route as CliLoginRoute } from "../../web/src/routes/cli-login";
import { Route as LoginRoute } from "../../web/src/routes/login";

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

const agentSession = {
  authenticated: true, githubOAuthEnabled: false, googleOAuthEnabled: false, discordOAuthEnabled: false,
  passwordAuthEnabled: true, emailAuthEnabled: false, trialDeployment: false,
  user: { id: "agent-1", username: "claude-code-7f3k", displayName: "Claude Code · 7f3k", avatarUrl: null, kind: "agent", claimed: false },
  authenticationMethods: { password: false, email: null, externalIdentities: [] },
};
const requests: string[] = [];
const assign = vi.fn();
let container: HTMLDivElement;
let root: Root;

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
    if (request.method === "GET" && url.pathname === "/api/session") return Response.json(agentSession);
    throw new Error(`Unexpected request ${request.method} ${url.pathname}`);
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.unstubAllGlobals();
});

async function open(route: AnyRoute, path: string, location: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const parent = createRootRouteWithContext<{ queryClient: QueryClient }>()();
  Object.assign(route.options, { getParentRoute: () => parent, path });
  const router = createRouter({
    routeTree: parent.addChildren([route]), context: { queryClient },
    history: createMemoryHistory({ initialEntries: [location] }),
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
const buttons = () => [...container.querySelectorAll("button")].map((button) => button.textContent);

it("keeps a browser that holds only an agent's cookie on the sign-in page, with the guest card, instead of returning to authorize", async () => {
  const returnTo = "/api/auth/authorize?client_id=client&scope=read";
  const router = await open(LoginRoute, "/login", `/login?returnTo=${encodeURIComponent(returnTo)}`);
  await waitFor(() => expect(buttons()).toContain("Continue as a guest agent"));
  expect(container.querySelector("#auth-username")).not.toBeNull();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(assign).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe("/login");
  expect(requests).toEqual(["GET /api/session"]);
});

it("asks a person to sign in before approving a CLI login when only an agent is signed in", async () => {
  await open(CliLoginRoute, "/cli-login", "/cli-login?userCode=ABCD-EFGH");
  await waitFor(() => expect(container.textContent).toContain("Sign in to Workspace first"));
  expect(container.querySelector("#auth-username")).not.toBeNull();
  expect(container.querySelector("#cli-login-code")).toBeNull();
});
