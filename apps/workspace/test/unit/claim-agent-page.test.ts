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

const CODE = "claim-code-1";
const methods = { githubOAuthEnabled: false, googleOAuthEnabled: false, discordOAuthEnabled: false, passwordAuthEnabled: true, emailAuthEnabled: false, guestAuthEnabled: true };
const people = {
  agent: { id: "agent-1", username: "claude-code-7f3k", displayName: "Claude Code · 7f3k", avatarUrl: null, kind: "agent", claimed: false },
  human: { id: "human-1", username: "olivia", displayName: "Olivia", avatarUrl: null, kind: "human" },
};
const agentSummary = { id: "agent-1", username: "claude-code-7f3k", displayName: "Claude Code · 7f3k", files: 1, spaceId: "space-1", stopped: false };
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
      return signedIn === "human"
        ? Response.json({ claimed: false, agent: agentSummary })
        : Response.json({ error: { code: "FORBIDDEN", message: "An agent cannot claim or manage agents. Sign in with your own account." } }, { status: 403 });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      signedIn = null;
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/password/login") {
      expect(await request.json()).toEqual({ username: "olivia", password: "correct horse battery staple" });
      signedIn = "human";
      return Response.json(session());
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
  const space = createRoute({ getParentRoute: () => parent, path: "/spaces/$spaceId", component: () => "Agent space" });
  const router = createRouter({
    routeTree: parent.addChildren([Route, space]), context: { queryClient },
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
async function fill(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("lets a browser signed in as an agent sign out, sign in as a person on the same claim link, and claim", async () => {
  signedIn = "agent";
  const router = await open();
  await waitFor(() => expect(container.textContent).toContain("An agent cannot claim an agent."));
  expect(button("Sign out and continue")).toBeDefined();

  await click("Sign out and continue");
  await waitFor(() => expect(container.textContent).toContain("Sign in to claim this agent"));
  expect(requests).toContain("POST /api/auth/logout");
  expect(router.state.location.pathname).toBe(`/claim/${CODE}`);

  await fill("auth-username", "olivia");
  await fill("auth-password", "correct horse battery staple");
  await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
  await waitFor(() => expect(assign).toHaveBeenCalledWith(`/claim/${CODE}`));

  await act(async () => root.unmount());
  root = createRoot(container);
  const reopened = await open();
  await waitFor(() => expect(button("Claim agent")).toBeDefined());
  expect(container.textContent).toContain("The agent will belong to “Olivia”.");
  await click("Claim agent");
  await waitFor(() => expect(reopened.state.location.pathname).toBe("/spaces/space-1"));
  expect(requests).toContain("POST /api/agents/claim");
});

it("offers only the way home when the claim link itself is the problem", async () => {
  signedIn = "human";
  http.fetch.mockImplementationOnce(async () => Response.json(session()));
  http.fetch.mockImplementationOnce(async () =>
    Response.json({ error: { code: "AGENT_CLAIM_EXPIRED", message: "The claim code expired." } }, { status: 410 }));
  await open();
  await waitFor(() => expect(container.textContent).toContain("This claim link has expired."));
  expect(button("Back to home")).toBeDefined();
  expect(button("Sign out and continue")).toBeUndefined();
});
