// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionQueryKey } from "../auth";
import { LanguageProvider } from "../../shared/i18n";
import { RemixButton, SaveMyVersionButton, useFinishPendingCopy } from "./remix";

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  navigate: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("./copy", () => ({ copyToPersonalSpace: mocks.copy }));
vi.mock("sonner", async (importOriginal) => ({ ...(await importOriginal<object>()), toast: mocks.toast }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ href: "/nodes/page?view=immersive" }),
  Link: ({ to, search, children, ...props }: { to: string; search: Record<string, string | undefined>; children: ReactNode }) => {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(search)) if (value !== undefined) query.set(name, value);
    return createElement("a", { ...props, href: `${to}?${query}` }, children);
  },
}));

let container: HTMLDivElement;
let root: Root;

async function render(signedIn: boolean, element: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sessionQueryKey, signedIn ? { authenticated: true, user: { id: "reader" } } : { authenticated: false });
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(LanguageProvider, null, element))));
}

function FinishPendingCopy({ nodeId }: { readonly nodeId: string }) {
  useFinishPendingCopy(nodeId, true);
  return null;
}

function button(text: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>("button, a")].find((element) => element.textContent === text);
  if (!found) throw new Error(`No control named ${text}`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.setItem("univer-workspace-language", "en-US");
  window.sessionStorage.clear();
  mocks.copy.mockResolvedValue("my-copy");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Remix", () => {
  it("copies the file into a signed-in reader's Personal Space and opens the copy", async () => {
    await render(true, createElement(RemixButton, { nodeId: "sheet" }));
    await act(async () => button("Remix").click());
    expect(mocks.copy).toHaveBeenCalledWith("sheet", expect.stringMatching(/^browser-/), expect.anything());
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/nodes/$nodeId", params: { nodeId: "my-copy" } });
    expect(mocks.toast.success).toHaveBeenCalledWith("Copied to your space. Your edits change only your copy.");
  });

  it("shows a signed-out reader the agent prompt and copies only after they sign up", async () => {
    await render(false, createElement(RemixButton, { nodeId: "sheet" }));
    await act(async () => button("Remix").click());
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(document.querySelector("pre")?.textContent).toContain(`${window.location.origin}/nodes/sheet`);
    const signUp = button("Sign up free");
    expect(signUp.getAttribute("href")).toBe(`/login?mode=register&returnTo=${encodeURIComponent("/nodes/page?view=immersive")}`);
    await act(async () => signUp.click());
    expect(JSON.parse(window.sessionStorage.getItem("univer-workspace-pending-copy") ?? "")).toMatchObject({ nodeId: "sheet", done: "remixDone" });
  });
});

describe("Save my version", () => {
  it("copies the page for a signed-in reader", async () => {
    await render(true, createElement(SaveMyVersionButton, { nodeId: "page" }));
    await act(async () => button("Save my version").click());
    expect(mocks.copy).toHaveBeenCalledWith("page", expect.stringMatching(/^browser-/), expect.anything());
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/nodes/$nodeId", params: { nodeId: "my-copy" } });
  });

  it("sends a signed-out reader to sign up, then makes the copy with the same key when they return", async () => {
    await render(false, createElement(SaveMyVersionButton, { nodeId: "page" }));
    await act(async () => button("Save my version").click());
    const { key } = JSON.parse(window.sessionStorage.getItem("univer-workspace-pending-copy") ?? "") as { key: string };

    await render(true, createElement(FinishPendingCopy, { nodeId: "page" }));
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith("page", key, expect.anything());
    expect(window.sessionStorage.getItem("univer-workspace-pending-copy")).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/nodes/$nodeId", params: { nodeId: "my-copy" } });
  });

  it("drops a pending copy of another file instead of making it later", async () => {
    await render(false, createElement(SaveMyVersionButton, { nodeId: "page" }));
    await act(async () => button("Save my version").click());
    await render(true, createElement(FinishPendingCopy, { nodeId: "other" }));
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("univer-workspace-pending-copy")).toBeNull();
  });
});
