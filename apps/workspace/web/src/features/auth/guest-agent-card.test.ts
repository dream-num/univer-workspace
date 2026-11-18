// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../shared/i18n";
import { GuestAgentCard } from "./guest-agent-card";

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

const returnTo = "/api/auth/authorize?client_id=client&scope=read";
const anonymous = {
  authenticated: false, githubOAuthEnabled: false, googleOAuthEnabled: false, discordOAuthEnabled: false,
  passwordAuthEnabled: true, emailAuthEnabled: false, guestAuthEnabled: true,
};
let root: Root;
let container: HTMLDivElement;
let queries: QueryClient;
let session: object;
let guestResponse: () => Response;
const requests: Request[] = [];
const assign = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Request", http.Request);
  vi.stubGlobal("fetch", http.fetch);
  vi.stubGlobal("location", { ...window.location, assign });
  window.localStorage.setItem("univer-workspace-language", "en-US");
  session = anonymous;
  guestResponse = () => Response.json({ agent: { id: "agent-1", username: "agent-7f3k" } }, { status: 201 });
  requests.length = 0;
  assign.mockClear();
  http.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/api/session") return Response.json(session);
    if (request.method === "POST" && path === "/api/auth/guest") return guestResponse();
    throw new Error(`Unexpected request ${request.method} ${path}`);
  });
  queries = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); queries.clear(); container.remove(); vi.unstubAllGlobals();
});

async function render(target?: string) {
  await act(async () => root.render(createElement(LanguageProvider, null,
    createElement(QueryClientProvider, { client: queries },
      createElement(GuestAgentCard, target ? { returnTo: target } : {})))));
  await waitFor(() => expect(queries.isFetching()).toBe(0));
}
async function waitFor(check: () => void) {
  for (let attempt = 0; ; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    try { check(); return; } catch (error) { if (attempt === 99) throw error; }
  }
}
function button() { return container.querySelector("button"); }
async function click() {
  await act(async () => button()?.click());
}
function guestPosts() { return requests.filter((request) => request.method === "POST"); }

it("offers the guest agent only when login returns to OAuth authorization", async () => {
  await render(returnTo);
  expect(button()?.textContent).toBe("Continue as a guest agent");
  expect(container.querySelector("section")?.getAttribute("aria-labelledby"))
    .toBe(container.querySelector("h2")?.id);
});

it.each([undefined, "/home"])("renders nothing for returnTo %j", async (target) => {
  await render(target);
  expect(container.innerHTML).toBe("");
});

it("renders nothing when the deployment has guest agents off", async () => {
  session = { ...anonymous, guestAuthEnabled: false };
  await render(returnTo);
  expect(container.innerHTML).toBe("");
});

it.each([returnTo, "/api/auth/authorize/consent?client_id=client&scope=read"])(
  "sends the authorization request it continues so the server checks it first, then continues to %s",
  async (target) => {
    await render(target);
    await click();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(target));
    expect(guestPosts().map((request) => new URL(request.url).pathname)).toEqual(["/api/auth/guest"]);
    expect(await guestPosts()[0]!.json()).toEqual({ oauthAuthorization: "client_id=client&scope=read" });
    expect(button()?.disabled).toBe(true);
  },
);

it("explains the rate limit in the page language and stays on the page", async () => {
  guestResponse = () => Response.json(
    { error: { code: "AGENT_CREATE_RATE_LIMITED", message: "Too many agents were created from this address." } },
    { status: 429 },
  );
  await render(returnTo);
  await click();
  await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent)
    .toBe("This network has reached its hourly limit for guest agent requests. Try again later, or sign in instead."));
  expect(assign).not.toHaveBeenCalled();
  expect(button()?.disabled).toBe(false);
});

it("shows any other server error as sent", async () => {
  guestResponse = () => Response.json(
    { error: { code: "CONFLICT", message: "Sign out before continuing as a guest agent." } },
    { status: 409 },
  );
  await render(returnTo);
  await click();
  await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent)
    .toBe("Sign out before continuing as a guest agent."));
});
