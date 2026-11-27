// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRouteWithContext, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../web/src/shared/i18n";
import { Route } from "../../web/src/routes/confirm.$action";

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

const methods = { githubOAuthEnabled: false, googleOAuthEnabled: false, discordOAuthEnabled: false, passwordAuthEnabled: true, emailAuthEnabled: false, guestAuthEnabled: true };
const people = {
  agent: { id: "agent-1", username: "claude-code-7f3k", displayName: "Claude Code · 7f3k", avatarUrl: null, kind: "agent", claimed: true },
  human: { id: "human-1", username: "olivia", displayName: "Olivia", avatarUrl: null, kind: "human" },
};
const wang = { id: "USER-ID", username: "wang", displayName: "Wang", avatarUrl: null };
const forbidden = () => Response.json({ error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." } }, { status: 403 });

let server: {
  signedIn: keyof typeof people | null;
  member: string | null;
  grant: string | null;
  link: string | null;
  publicRead: boolean;
  mayManage: boolean;
  mayWrite: boolean;
};
const writes: { readonly call: string; readonly body: unknown }[] = [];
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Request", http.Request);
  vi.stubGlobal("fetch", http.fetch);
  window.localStorage.setItem("univer-workspace-language", "en-US");
  server = { signedIn: "human", member: null, grant: null, link: null, publicRead: false, mayManage: true, mayWrite: true };
  writes.length = 0;
  http.fetch.mockClear();
  http.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const call = `${request.method} ${url.pathname}`;
    const row = (role: string) => ({ user: wang, role, grantedBy: people.human, createdAt: "2026-11-26T00:00:00.000Z", updatedAt: "2026-11-26T00:00:00.000Z" });
    const sharing = () => ({
      enabled: server.link !== null, role: server.link ?? "viewer", owner: { username: "olivia", kind: "human" }, expiresAt: null,
      createdBy: null, updatedBy: null, createdAt: null, updatedAt: null,
    });
    if (call === "POST /api/resources/page-resource/open") return Response.json({ resource: { kind: "blob", contentUrl: "/page-content" } });
    if (call === "GET /page-content") return new Response('<!doctype html><html><body><p data-univer-cell-text="sheet-unit:Sheet1:A1"></p></body></html>');
    if (request.credentials === "omit" && (call === "GET /api/nodes/PAGE-ID" || call === "GET /api/unit-resources/sheet-unit")) {
      return Response.json({ error: { code: "NOT_FOUND", message: "The resource was not found." } }, { status: 404 });
    }
    if (call === "GET /api/unit-resources/sheet-unit") return Response.json({ node: { id: "SHEET-NODE", name: "Q3 numbers" } });
    if (request.method !== "GET") {
      const body: unknown = await request.json();
      writes.push({ call, body });
      if (!server.mayWrite) return forbidden();
      const { role, publicRead } = body as { role?: string; publicRead?: boolean };
      if (call === "PATCH /api/spaces/SPACE-ID") return Response.json({ ...space(), publicRead: (server.publicRead = publicRead!) });
      if (call === "PUT /api/team-spaces/SPACE-ID/members/USER-ID") return Response.json(row((server.member = role!)));
      if (call === "PUT /api/nodes/NODE-ID/grants/USER-ID") return Response.json(row((server.grant = role!)));
      if (call === "PUT /api/nodes/NODE-ID/link-sharing") {
        server.link = role!;
        return Response.json(sharing());
      }
    }
    if (call === "GET /api/session") {
      return Response.json(server.signedIn === null
        ? { authenticated: false, ...methods }
        : { authenticated: true, ...methods, user: people[server.signedIn], authenticationMethods: { password: true, email: null, externalIdentities: [] } });
    }
    if (call === "GET /api/spaces/SPACE-ID") return Response.json(space());
    if (call === "GET /api/team-spaces/SPACE-ID/members") {
      return server.mayManage ? Response.json({ owner: people.human, members: server.member ? [row(server.member)] : [] }) : forbidden();
    }
    if (call === "GET /api/users/search") {
      return Response.json({ users: url.searchParams.get("query") === wang.id ? [{ ...wang, id: "other", username: "wang-2" }, wang] : [] });
    }
    if (call === "GET /api/nodes/NODE-ID") {
      return Response.json({
        node: { id: "NODE-ID", spaceId: "SPACE-ID", parentNodeId: null, name: "Q3 plan", hasChildren: false, accessRole: "owner", updatedAt: "2026-11-26T00:00:00.000Z", resource: { id: "r1", kind: "univer", unitId: "u1", unitType: "sheet" } },
        space: space(), owner: null, breadcrumbs: [], navigationRootNodeId: null, copiedFromNodeId: null, copyCount: 0,
      });
    }
    if (call === "GET /api/nodes/PAGE-ID") {
      return Response.json({
        node: { id: "PAGE-ID", spaceId: "SPACE-ID", parentNodeId: null, name: "Q3.univer.html", hasChildren: false, accessRole: "owner", updatedAt: "2026-11-26T00:00:00.000Z", resource: { id: "page-resource", kind: "blob" } },
        space: space(), owner: null, breadcrumbs: [], navigationRootNodeId: null, copiedFromNodeId: null, copyCount: 0,
      });
    }
    if (call === "GET /api/nodes/PAGE-ID/link-sharing") return Response.json(sharing());
    if (call === "GET /api/nodes/NODE-ID/grants") return Response.json({ grants: server.grant ? [row(server.grant)] : [] });
    if (call === "GET /api/nodes/NODE-ID/link-sharing") return Response.json(sharing());
    throw new Error(`Unexpected request ${call}`);
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.unstubAllGlobals();
});

function space() {
  return { id: "SPACE-ID", type: "team", name: "site", fullName: "acme/site", slug: "site", publicRead: server.publicRead, accessRole: "owner", capabilities: {} };
}

async function open(link: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const parent = createRootRouteWithContext<{ queryClient: QueryClient }>()();
  Object.assign(Route.options, { getParentRoute: () => parent, path: "/confirm/$action" });
  const target = (path: string) => createRoute({ getParentRoute: () => parent, path, component: () => `Opened ${path}` });
  const router = createRouter({
    routeTree: parent.addChildren([Route, target("/spaces/$spaceId"), target("/nodes/$nodeId"), target("/home")]), context: { queryClient },
    history: createMemoryHistory({ initialEntries: [link] }),
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
const button = (name: string) => [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === name);
const buttons = () => [...container.querySelectorAll("button")].map((candidate) => candidate.textContent);
const levels = () => [...container.querySelectorAll("dl > div")].map((row) => [row.querySelector("dt")!.textContent, row.querySelector("dd")!.textContent]);

it.each([
  {
    link: "/confirm/public?space=SPACE-ID", title: "Make acme/site public?",
    consequence: "Anyone with the link will be able to read every file in acme/site without signing in.",
    before: "Private", after: "Public", write: { call: "PATCH /api/spaces/SPACE-ID", body: { publicRead: true } }, opened: "/spaces/SPACE-ID",
  },
  {
    link: "/confirm/member?space=SPACE-ID&user=USER-ID&role=editor", title: "Give Wang (@wang) access to acme/site?",
    consequence: "Wang (@wang) will be able to read and edit every file in acme/site.",
    before: "Not a member", after: "Can edit", write: { call: "PUT /api/team-spaces/SPACE-ID/members/USER-ID", body: { role: "editor" } }, opened: "/spaces/SPACE-ID",
  },
  {
    link: "/confirm/grant?node=NODE-ID&user=USER-ID&role=viewer", title: "Share Q3 plan with Wang (@wang)?",
    consequence: "Wang (@wang) will be able to read Q3 plan.",
    before: "Not shared", after: "Can view", write: { call: "PUT /api/nodes/NODE-ID/grants/USER-ID", body: { role: "viewer" } }, opened: "/nodes/NODE-ID",
  },
  {
    link: "/confirm/link-sharing?node=NODE-ID&role=editor", title: "Turn on Link Sharing for Q3 plan?",
    consequence: "Anyone with the link will be able to read Q3 plan without signing in, and signed-in people will be able to edit it.",
    before: "Off", after: "Can edit", write: { call: "PUT /api/nodes/NODE-ID/link-sharing", body: { enabled: true, role: "editor" } }, opened: "/nodes/NODE-ID",
  },
])("shows $link with names the person's session read, writes through the existing endpoint only on Confirm, and then opens the target", async (c) => {
  const router = await open(`${c.link}&title=Trust+me&name=A+harmless+rename`);
  await waitFor(() => expect(container.querySelector("h1")?.textContent).toBe(c.title));
  expect(container.textContent).toContain(c.consequence);
  expect(levels()).toEqual([["Now", c.before], ["After you confirm", c.after]]);
  expect(buttons(), "confirm or give up, and nothing to edit").toEqual(["Confirm", "Give up"]);
  expect(container.querySelector("input, select, textarea")).toBeNull();
  for (const fromLink of ["Trust me", "harmless", "SPACE-ID", "NODE-ID", "USER-ID"]) expect(container.textContent).not.toContain(fromLink);
  expect(writes).toEqual([]);

  await act(async () => button("Confirm")!.click());
  await waitFor(() => expect(container.textContent).toContain("Done."));
  expect(writes).toEqual([c.write]);
  expect(levels()).toEqual([["Now", c.after]]);
  await act(async () => button("Open")!.click());
  await waitFor(() => expect(router.state.location.pathname).toBe(c.opened));
});

it("lists an HTML View's source Sheets on its Link Sharing confirm page and warns that link visitors cannot read them, and lists none for a Sheet", async () => {
  const sources = () => container.querySelector('section[aria-label="Source Sheets"]');
  await open("/confirm/link-sharing?node=NODE-ID&role=viewer");
  await waitFor(() => expect(button("Confirm")).toBeDefined());
  expect(sources()).toBeNull();

  await open("/confirm/link-sharing?node=PAGE-ID&role=viewer");
  await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("Enable link sharing on the source Sheets too"));
  expect(sources()?.querySelector("li")?.textContent).toContain("Q3 numbers");
  expect(sources()?.querySelector("li")?.textContent).toContain("Not readable by link visitors");
  expect(buttons()).toEqual(["Confirm", "Give up"]);
  expect(writes).toEqual([]);
});

it("shows the stored role beside a lower one the link asks for, and still lets the person confirm it", async () => {
  server.member = "admin";
  await open("/confirm/member?space=SPACE-ID&user=USER-ID&role=viewer");
  await waitFor(() => expect(levels()).toEqual([["Now", "Admin"], ["After you confirm", "Can view"]]));
  await act(async () => button("Confirm")!.click());
  await waitFor(() => expect(levels()).toEqual([["Now", "Can view"]]));
  expect(writes).toEqual([{ call: "PUT /api/team-spaces/SPACE-ID/members/USER-ID", body: { role: "viewer" } }]);
});

it("leaves without writing when the person gives up", async () => {
  const router = await open("/confirm/link-sharing?node=NODE-ID&role=viewer");
  await waitFor(() => expect(button("Give up")).toBeDefined());
  await act(async () => button("Give up")!.click());
  await waitFor(() => expect(router.state.location.pathname).toBe("/nodes/NODE-ID"));
  expect(writes).toEqual([]);
});

it("shows a person without the capability the server's refusal, with nothing to confirm", async () => {
  server.mayManage = false;
  await open("/confirm/member?space=SPACE-ID&user=USER-ID&role=editor");
  await waitFor(() => expect(container.textContent).toContain("You do not have permission to perform this action."));
  expect(buttons()).toEqual(["Back to home"]);
  expect(writes).toEqual([]);
});

it("shows the server's refusal when the write itself is refused, and leaves the change unconfirmed", async () => {
  server.mayWrite = false;
  await open("/confirm/public?space=SPACE-ID");
  await waitFor(() => expect(button("Confirm")).toBeDefined());
  await act(async () => button("Confirm")!.click());
  await waitFor(() => expect(container.textContent).toContain("You do not have permission to perform this action."));
  expect(container.textContent).not.toContain("Done.");
  expect(levels()).toEqual([["Now", "Private"], ["After you confirm", "Public"]]);
});

it.each([
  "/confirm/member?space=SPACE-ID&role=editor",
  "/confirm/member?space=SPACE-ID&user=USER-ID&role=owner",
  "/confirm/grant?node=NODE-ID&user=USER-ID&role=admin",
  "/confirm/create-public?space=SPACE-ID",
])("offers only the way home for the invalid link %s, and reads nothing it names", async (link) => {
  await open(link);
  await waitFor(() => expect(container.textContent).toContain("This confirm link is not valid"));
  expect(buttons()).toEqual(["Back to home"]);
  expect(http.fetch.mock.calls).toHaveLength(1);
});

it("says so when the link names a user Workspace cannot find, with nothing to confirm", async () => {
  await open("/confirm/grant?node=NODE-ID&user=nobody&role=viewer");
  await waitFor(() => expect(container.textContent).toContain("Workspace cannot find the user this link names."));
  expect(buttons()).toEqual(["Back to home"]);
});

it.each([null, "agent"] as const)("asks a browser signed in as %s to sign in as a person, and reads nothing the link names", async (signedIn) => {
  server.signedIn = signedIn;
  await open("/confirm/public?space=SPACE-ID");
  await waitFor(() => expect(container.textContent).toContain("Sign in to Workspace first"));
  expect(container.querySelector("form")).not.toBeNull();
  expect(button("Confirm")).toBeUndefined();
  expect(http.fetch.mock.calls.map(([input]) => new URL((input as Request).url).pathname)).toEqual(["/api/session"]);
});
