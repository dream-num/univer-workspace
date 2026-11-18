// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionQueryKey } from "../auth";
import { LanguageProvider } from "../../shared/i18n";
import { handToAgentPrompt } from "./hand-to-agent";
import { nodeQueryOptions } from "./nodes.queries";
import { RemixButton, SaveMyVersionButton, useFinishPendingCopy } from "./remix";

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  navigate: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  writeText: vi.fn(),
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

const PENDING_COPY = "univer-workspace-pending-copy";
let container: HTMLDivElement;
let root: Root;

async function render(signedIn: boolean, element: ReactNode, resource: unknown = { kind: "univer", unitType: "sheet" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sessionQueryKey, signedIn ? { authenticated: true, user: { id: "reader" } } : { authenticated: false });
  client.setQueryData(nodeQueryOptions("sheet").queryKey, { node: { id: "sheet", resource } } as never);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(LanguageProvider, null, element))));
}

function FinishPendingCopy({ nodeId, returnKey }: { readonly nodeId: string; readonly returnKey: string | undefined }) {
  useFinishPendingCopy(nodeId, true, returnKey);
  return null;
}

function button(text: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>("button, a")].find((element) => element.textContent === text);
  if (!found) throw new Error(`No control named ${text}`);
  return found;
}

function pending(): { nodeId: string; key: string; expiresAt: number } {
  return JSON.parse(window.sessionStorage.getItem(PENDING_COPY) ?? "null");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { clipboard: { writeText: mocks.writeText } });
  window.localStorage.setItem("univer-workspace-language", "en-US");
  window.sessionStorage.clear();
  mocks.copy.mockResolvedValue("my-copy");
  mocks.writeText.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
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

  it("makes one copy for clicks that land while the copy is running", async () => {
    let finish!: (id: string) => void;
    mocks.copy.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render(true, createElement(RemixButton, { nodeId: "sheet" }));
    await act(async () => {
      const remix = button("Remix");
      remix.click();
      remix.click();
      remix.click();
    });
    expect(mocks.copy).toHaveBeenCalledOnce();
    await act(() => vi.waitFor(() => expect(button("Copying…")).toHaveProperty("disabled", true)));
    await act(async () => finish("my-copy"));
    expect(mocks.navigate).toHaveBeenCalledOnce();
  });

  it("shows the toast the copy fails with", async () => {
    mocks.copy.mockRejectedValue(new Error("This page uses a Sheet you cannot open, so it cannot be copied. Nothing was created."));
    await render(true, createElement(RemixButton, { nodeId: "sheet" }));
    await act(async () => button("Remix").click());
    expect(mocks.toast.error).toHaveBeenCalledWith("This page uses a Sheet you cannot open, so it cannot be copied. Nothing was created.");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("gives a signed-out reader the agent prompt that copies, and copies only after they sign up", async () => {
    await render(false, createElement(RemixButton, { nodeId: "sheet" }));
    await act(async () => button("Remix").click());
    expect(mocks.copy).not.toHaveBeenCalled();
    const mcp = handToAgentPrompt(window.location.origin, "sheet", "copy", "mcp");
    expect(document.querySelector("pre")?.textContent).toBe(mcp);
    await act(async () => button("Hand to my agent").click());
    expect(mocks.writeText).toHaveBeenLastCalledWith(mcp);
    await act(async () => button("Command line (uvw)").click());
    await act(async () => button("Hand to my agent").click());
    expect(mocks.writeText).toHaveBeenLastCalledWith(handToAgentPrompt(window.location.origin, "sheet", "copy", "cli"));

    const signUp = button("Sign up free");
    const returnTo = new URL(new URLSearchParams(signUp.getAttribute("href")!.split("?")[1]).get("returnTo")!, window.location.origin);
    expect(returnTo.pathname + "?" + new URLSearchParams([...returnTo.searchParams].filter(([name]) => name !== "copy"))).toBe("/nodes/page?view=immersive");
    await act(async () => signUp.click());
    expect(pending()).toMatchObject({ nodeId: "sheet", key: returnTo.searchParams.get("copy"), done: "remixDone" });
  });

  it("offers a signed-out reader only sign-up for a file an agent cannot copy", async () => {
    await render(false, createElement(RemixButton, { nodeId: "sheet" }), { kind: "blob" });
    await act(async () => button("Remix").click());
    expect(document.querySelector("pre")).toBeNull();
    expect(() => button("Hand to my agent")).toThrow();
    expect(document.body.textContent).toContain("Sign up and this file is copied into your own space for you to edit.");
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
    const { key } = pending();

    await render(true, createElement(FinishPendingCopy, { nodeId: "page", returnKey: key }));
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith("page", key, expect.anything());
    expect(window.sessionStorage.getItem(PENDING_COPY)).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/nodes/$nodeId", params: { nodeId: "my-copy" } });
  });

  it("makes a pending copy only on the sign-up return it was made for", async () => {
    await render(false, createElement(SaveMyVersionButton, { nodeId: "page" }));
    await act(async () => button("Save my version").click());
    const { key } = pending();

    await render(true, createElement(FinishPendingCopy, { nodeId: "page", returnKey: undefined }));
    await render(true, createElement(FinishPendingCopy, { nodeId: "page", returnKey: "browser-someone-elses-link" }));
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(pending()).toMatchObject({ key });
  });

  it("drops a pending copy that expired or names another file instead of making it", async () => {
    await render(false, createElement(SaveMyVersionButton, { nodeId: "page" }));
    await act(async () => button("Save my version").click());
    const { key } = pending();
    await render(true, createElement(FinishPendingCopy, { nodeId: "other", returnKey: key }));
    expect(window.sessionStorage.getItem(PENDING_COPY)).toBeNull();

    await render(false, createElement(SaveMyVersionButton, { nodeId: "page" }));
    await act(async () => button("Save my version").click());
    vi.useFakeTimers({ toFake: ["Date"], now: pending().expiresAt });
    await render(true, createElement(FinishPendingCopy, { nodeId: "page", returnKey: pending().key }));
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PENDING_COPY)).toBeNull();
  });
});
