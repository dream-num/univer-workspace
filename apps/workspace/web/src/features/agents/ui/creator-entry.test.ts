// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRouteWithContext, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../../shared/i18n";
import { Route } from "../../../routes/spaces_.$spaceId.agents";
import { AgentsPage } from "./sessions";

const { start } = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("../../auth", () => ({
  requireAuthenticatedSession: async () => ({ authenticated: true }),
  sessionQueryOptions: { queryKey: ["session"], queryFn: async () => ({ authenticated: false }) },
}));
vi.mock("../../spaces", () => ({ ensureSpace: async () => ({ id: "repo" }) }));
vi.mock("../../../modes/registry", () => ({ useModeDefinition: () => ({
  pages: { agents: TestAgentsPage },
}) }));
vi.mock("./client", () => ({ useAgentClient: () => ({
  userId: "user", sessions: { list: async () => [], subscribe: () => () => {} },
  prewarm: async () => {}, runner: async () => ({ start }),
}) }));
vi.mock("./composer-settings", () => ({
  useAgentModel: () => ({ selected: { provider: { id: "provider", kind: "openai" }, modelId: "model" }, setSettings: vi.fn() }),
  AgentModelControls: () => null, AgentRepositorySelect: () => null,
}));
vi.mock("./references", () => ({ AgentReferencePicker: () => null, AgentReferencePill: () => null, referenceTrigger: () => null }));

function TestAgentsPage(props: { spaceId: string; prompt?: string }) {
  return createElement(AgentsPage, { ...props, renderPage: (content) => content });
}

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
  // Browsers focus contenteditable when Selection moves into it; jsdom does not.
  const setBaseAndExtent = Selection.prototype.setBaseAndExtent;
  vi.spyOn(Selection.prototype, "setBaseAndExtent").mockImplementation(function (this: Selection, anchor, anchorOffset, focus, focusOffset) {
    setBaseAndExtent.call(this, anchor, anchorOffset, focus, focusOffset);
    anchor.parentElement?.closest<HTMLElement>('[contenteditable="true"]')?.focus();
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.setItem("univer-workspace-language", "en-US");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["space", "repo"], { name: "Test" });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});
async function open(search = "") {
  const parent = createRootRouteWithContext<{ queryClient: QueryClient }>()();
  const route = Route;
  Object.assign(route.options, { getParentRoute: () => parent, path: "/spaces/$spaceId/agents" });
  const router = createRouter({
    routeTree: parent.addChildren([route]), context: { queryClient: client },
    history: createMemoryHistory({ initialEntries: [`/spaces/repo/agents${search}`] }),
  });
  await act(async () => {
    await router.load();
    root.render(createElement(QueryClientProvider, { client }, createElement(LanguageProvider, null, createElement(RouterProvider, { router }))));
  });
  return router;
}
it("prefills the route prompt in the real composer and focuses it without starting a session", async () => {
  const prompt = '/html-view-creator Make a page from "Revenue" (resource sheet-id).';
  const router = await open(`?prompt=${encodeURIComponent(prompt)}`);
  const editor = container.querySelector(".agent-editor");
  expect(editor?.textContent).toBe(prompt);
  expect(document.activeElement).toBe(editor);
  expect(start).not.toHaveBeenCalled();
  await act(async () => { await router.navigate({ to: "/spaces/$spaceId/agents", params: { spaceId: "repo" }, search: { prompt: "Another request" } }); });
  expect(editor?.textContent).toBe("Another request");
  expect(document.activeElement).toBe(editor);
  expect(start).not.toHaveBeenCalled();
});
it("keeps the composer empty without prompt and uses the creator prompt from the existing page starter", async () => {
  await open();
  const editor = container.querySelector(".agent-editor");
  expect(editor?.textContent).toBe("");
  expect(document.activeElement).not.toBe(editor);
  const starter = container.querySelectorAll<HTMLButtonElement>(".agent-starters button")[2];
  expect(starter?.textContent).toContain("page");
  await act(async () => starter?.click());
  expect(editor?.textContent).toBe("/html-view-creator Help me create a page bound to spreadsheet data.");
  expect(document.activeElement).toBe(editor);
  expect(start).not.toHaveBeenCalled();
});
it("validates optional prompt values at the route boundary", () => {
  const validate = Route.options.validateSearch;
  if (typeof validate !== "function") throw new Error("Missing search validator");
  expect(validate({})).toEqual({});
  expect(validate({ prompt: 42 })).toEqual({});
  expect(validate({ prompt: "Hello" })).toEqual({ prompt: "Hello" });
});
