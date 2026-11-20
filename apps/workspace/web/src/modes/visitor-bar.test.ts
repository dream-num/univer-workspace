// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionQueryKey } from "../features/auth";
import { LanguageProvider } from "../shared/i18n";
import { VisitorBar } from "./visitor-bar";
import { WorkspaceLayout } from "./workspace-layout";

const { controls, ui } = vi.hoisted(() => ({ controls: new Map<string, () => unknown>(), ui: { interactive: false } }));
const href = "/nodes/one?view=immersive#chart";

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ href: "/nodes/one?view=immersive#chart" }),
  useNavigate: () => vi.fn(),
  Link: ({ to, search, children, ...props }: {
    to: string; search: Record<string, string | undefined>; children: ReactNode;
  }) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (value !== undefined) query.set(key, value);
    }
    return createElement("a", { ...props, href: `${to}?${query}` }, children);
  },
}));
vi.mock("./registry", () => ({
  useModeDefinition: () => ({
    Shell: ({ children }: { children?: ReactNode }) => createElement("div", null, "Signed-in shell", children),
  }),
}));
vi.mock("../features/shell", () => ({ WorkspaceHeaderSearch: () => null }));
vi.mock("../features/spaces", () => ({ CreateTeamDialog: () => null }));
vi.mock("../shared/ui-mode", () => ({ useUiMode: () => ({ mode: "repository" }) }));
vi.mock("../shared/ui", async (importOriginal) => {
  const { Button } = await import("../shared/ui/button");
  const original = await importOriginal<typeof import("../shared/ui")>();
  return {
    ...original,
    LoadingScreen: () => null,
    MenuContent: ({ children }: { children?: ReactNode }) => ui.interactive
      ? createElement(original.MenuContent, { align: "end" }, children)
      : createElement("div", { role: "menu" }, children),
    MenuItem: ({ children, disabled, onClick }: { children?: ReactNode; disabled?: boolean; onClick?: () => unknown }) => {
      if (ui.interactive) return createElement(original.MenuItem, { disabled, onClick }, children);
      const label = renderToStaticMarkup(createElement("span", null, children)).replace(/<[^>]*>/g, "");
      if (onClick) controls.set(label, onClick);
      return createElement("button", { role: "menuitem", disabled }, children);
    },
    MenuSeparator: () => ui.interactive ? createElement(original.MenuSeparator) : createElement("hr", { role: "separator" }),
    Button: (props: Omit<ComponentProps<typeof Button>, "onClick"> & { onClick?: () => unknown }) => {
      if (props.onClick) controls.set(props["aria-label"] ?? "copy", props.onClick);
      return createElement(Button, props);
    },
  };
});

const clients: QueryClient[] = [];
let storage: Map<string, string>;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  ui.interactive = false;
  storage = new Map();
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("window", {
    location: { href: `https://workspace.example${href}` },
    localStorage: { getItem: () => "en-US" },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  controls.clear();
  vi.unstubAllGlobals();
});

type NodeOwner = { displayName: string; kind: "human" } | { displayName: string; kind: "agent"; claimed: boolean };

function renderLayout(authenticated = false, immersive = true, owner?: NodeOwner | null, accessRole = "viewer", copyCount = 0) {
  controls.clear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  client.setQueryData(sessionQueryKey, { authenticated });
  if (owner !== undefined) client.setQueryData(["nodes", "one"], { owner, copyCount, node: { id: "one", accessRole, resource: { id: "r" } } });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(LanguageProvider, null,
      createElement(WorkspaceLayout, { immersive, ...(owner === undefined ? {} : { selectedNodeId: "one" }) },
        createElement("iframe", { title: "Shared app" })),
    ),
  ));
}

const unverifiedAgent: NodeOwner = { displayName: "Budget bot", kind: "agent", claimed: false };

describe("share page header", () => {
  it.each([false, true])("names the author, links the brand and offers Report to a signed-out visitor (immersive: %s)", (immersive) => {
    const html = renderLayout(false, immersive, unverifiedAgent);
    const bar = html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
    expect(bar).toContain(">By Budget bot<");
    expect(bar).toContain(">Unverified agent<");
    expect(bar).toMatch(/<a[^>]*href="https:\/\/github.com\/dream-num\/univer-workspace"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*aria-label="Made with Univer Workspace"[^>]*title="Made with Univer Workspace"><svg/);
    expect(bar).not.toContain(">Made with Univer Workspace<");
    expect(bar).not.toContain(["space", "univer", "ai"].join("."));
    expect(bar).toContain('aria-label="More actions"');
    expect(bar).toMatch(/<button[^>]*>.*Report<\/button>/);
    expect(bar).toMatch(/<button[^>]*>.*Hand to my agent<\/button>/);
    expect(bar).toMatch(/<button[^>]*>.*Remix<\/button>/);
    expect(bar).toContain('title="By Budget bot"');
    expect(bar.includes("Sign up free")).toBe(immersive);
    expect(bar.includes('aria-label="Collapse sign-up bar"')).toBe(immersive);
    expect(bar).toContain('role="status"');
    expect(html.indexOf("</aside>")).toBeLessThan(html.indexOf("<main"));
  });

  it("offers no Remix for a folder", () => {
    const client = new QueryClient();
    clients.push(client);
    client.setQueryData(sessionQueryKey, { authenticated: false });
    client.setQueryData(["nodes", "one"], { owner: null, copyCount: 0, node: { id: "one", accessRole: "viewer", resource: null } });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(LanguageProvider, null, createElement(WorkspaceLayout, { immersive: false, selectedNodeId: "one" }))));
    expect(html).toContain("Report");
    expect(html).not.toContain("Remix");
  });

  it("orders secondary actions in the menu and omits node actions without a node", () => {
    const html = renderLayout(false, true, unverifiedAgent);
    const menu = html.slice(html.indexOf('role="menu"'), html.indexOf("</aside>"));
    const document = new DOMParser().parseFromString(html, "text/html");
    expect([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent))
      .toEqual(["Remix", "Hand to my agent", "Copy link", "Report"]);
    expect(menu.indexOf('role="separator"')).toBeGreaterThan(menu.indexOf("Copy link"));
    expect(menu.indexOf('role="separator"')).toBeLessThan(menu.indexOf("Report"));
    const withoutNode = renderLayout();
    expect(withoutNode).toContain("Copy link");
    expect(withoutNode).not.toContain("Hand to my agent");
    expect(withoutNode).not.toContain("Remix");
    expect(withoutNode).not.toContain(">Report<");
  });

  it("counts the copies of the file once there is one", () => {
    expect(renderLayout(false, false, unverifiedAgent)).not.toMatch(/\d cop(y|ies)</);
    expect(renderLayout(false, false, unverifiedAgent, "viewer", 1)).toContain(">1 copy<");
    expect(renderLayout(true, false, unverifiedAgent, "viewer", 12)).toContain(">12 copies<");
  });

  it("marks only an unclaimed agent as unverified", () => {
    const human = renderLayout(false, false, { displayName: "Alice", kind: "human" });
    expect(human).toContain(">By Alice<");
    expect(human).not.toContain("Unverified agent");
    expect(human).not.toContain(">Agent<");
    const claimed = renderLayout(false, false, { ...unverifiedAgent, claimed: true });
    expect(claimed).toContain(">Agent<");
    expect(claimed).not.toContain("Unverified agent");
  });

  it("names no author in a Team Space but still links the brand and offers Report", () => {
    const html = renderLayout(false, false, null);
    expect(html).not.toContain(">By ");
    expect(html).toContain("Made with Univer Workspace");
    expect(html).toContain("Report");
  });

  it("shows a signed-in reader of someone else's Personal Space file the bar without sign-up", () => {
    const html = renderLayout(true, false, unverifiedAgent, "editor");
    expect(html).toContain("Signed-in shell");
    expect(html).toContain(">By Budget bot<");
    expect(html).toContain(">Unverified agent<");
    expect(html).toMatch(/<button[^>]*>.*Report<\/button>/);
    expect(html).toContain("Hand to my agent");
    expect(html).toMatch(/<button[^>]*>.*Remix<\/button>/);
    expect(html).not.toContain("Sign up");
    expect(html).not.toContain("Sign in");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="More actions"');
    expect(html).toContain("Copy link");
    expect(html).not.toContain('aria-label="Collapse sign-up bar"');
    expect(html.indexOf("</aside>")).toBeLessThan(html.indexOf("<iframe"));
  });

  it("leaves the owner's and Team Space members' signed-in view unchanged", () => {
    for (const html of [renderLayout(true, false, unverifiedAgent, "owner"), renderLayout(true, false, null, "editor")]) {
      expect(html).toContain("Signed-in shell");
      expect(html).not.toContain("<aside");
    }
  });
});

describe("visitor sign-up bar", () => {
  it("renders between the header and main area for signed-out immersive visitors", () => {
    const html = renderLayout();
    expect(html).toContain("Made with Univer Workspace");
    expect(html).toContain("Sign up free");
    expect(html).toContain("Copy link");
    expect(html).toContain('<aside aria-label="Made with Univer Workspace"');
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("<aside"));
    expect(html.indexOf("</aside>")).toBeLessThan(html.indexOf("<main"));
    expect(html).toContain("lucide-chevron-up");
    expect(html).toContain('aria-label="Collapse sign-up bar"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(`href="/login?mode=register&amp;returnTo=${encodeURIComponent(href)}"`);
    expect(html).toContain(`href="/login?returnTo=${encodeURIComponent(href)}"`);
  });

  it("persists collapse and expansion across remounts using tab storage", () => {
    renderLayout();
    controls.get("Collapse sign-up bar")?.();
    expect([...storage.values()]).toEqual(["true"]);
    const collapsed = renderLayout();
    expect(collapsed).toContain("lucide-chevron-down");
    expect(collapsed).toContain('aria-label="Expand sign-up bar"');
    expect(collapsed).not.toContain("Sign up free");
    expect(collapsed).not.toContain('aria-label="More actions"');
    expect(collapsed).toContain("Univer Workspace");
    controls.get("Expand sign-up bar")?.();
    expect([...storage.values()]).toEqual(["false"]);
    expect(renderLayout()).toContain("Sign up free");
  });

  it("offers both authentication links in the non-immersive header", () => {
    const html = renderLayout(false, false);
    const header = html.split("</header>")[0] ?? "";
    expect(header).toContain(">Sign up</a>");
    expect(header).toContain(">Sign in</a>");
    expect(header).toContain(`href="/login?mode=register&amp;returnTo=${encodeURIComponent(href)}"`);
    expect(html).not.toContain("<aside");
    expect(html).not.toContain("Sign up free");
  });

  it("never renders the bar for signed-in users", () => {
    expect(renderLayout(true)).toContain("Signed-in shell");
    expect(renderLayout(true)).not.toContain("<aside");
    expect(renderLayout(true)).not.toContain("Sign up free");
  });

  it("copies the full current URL and handles clipboard failure", async () => {
    renderLayout();
    await controls.get("Copy link")?.();
    expect(writeText).toHaveBeenCalledWith(`https://workspace.example${href}`);
    writeText.mockRejectedValueOnce(new Error("Clipboard denied"));
    await expect(controls.get("Copy link")?.()).resolves.toBeUndefined();
  });

  it("still renders and collapses when sessionStorage is unavailable", () => {
    Object.defineProperty(window, "sessionStorage", { get: () => { throw new Error("Storage denied"); } });
    expect(renderLayout()).toContain("Sign up free");
    expect(() => controls.get("Collapse sign-up bar")?.()).not.toThrow();
  });
});

describe("visitor menu interactions", () => {
  async function mount(authenticated = false) {
    vi.unstubAllGlobals();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    window.localStorage.setItem("univer-workspace-language", "en-US");
    window.sessionStorage.clear();
    ui.interactive = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    client.setQueryData(sessionQueryKey, { authenticated });
    client.setQueryData(["nodes", "one"], { node: { id: "one", resource: { kind: "univer", unitType: "sheet" } } });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(QueryClientProvider, { client },
      createElement(LanguageProvider, null, createElement(VisitorBar, { offerSignUp: !authenticated, nodeId: "one", owner: unverifiedAgent, copyable: true })))));
    return async () => {
      await act(async () => root.unmount());
      container.remove();
    };
  }

  function control(name: string) {
    const found = [...document.querySelectorAll<HTMLElement>("button, [role=menuitem]")]
      .find((element) => (element.getAttribute("aria-label") ?? element.textContent) === name);
    if (!found) throw new Error(`Missing control ${name}`);
    return found;
  }

  it.each([
    ["Remix", "Remix this file"],
    ["Hand to my agent", "Hand to my agent"],
    ["Report", "Report this file"],
  ])("keeps the %s dialog open after its menu closes", async (action, title) => {
    const cleanup = await mount();
    try {
      await act(async () => control("More actions").click());
      expect(document.querySelector('[role="menu"]')).not.toBeNull();
      await act(async () => control(action).click());
      await act(() => vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull()));
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(title);
      await act(async () => control("Close").click());
      await act(() => vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull()));
    } finally {
      await cleanup();
    }
  });

  it.each([false, true])("announces copy success and failure with signed-in=%s", async (authenticated) => {
    const cleanup = await mount(authenticated);
    try {
      await act(async () => control("More actions").click());
      await act(async () => control("Copy link").click());
      expect(writeText).toHaveBeenLastCalledWith(window.location.href);
      expect(document.querySelector('[role="status"]')?.textContent).toBe("Link copied.");
      writeText.mockRejectedValueOnce(new Error("Clipboard denied"));
      await act(async () => control("More actions").click());
      await act(async () => control("Copy link").click());
      expect(document.querySelector('[role="status"]')?.textContent).toBe("Unable to copy the link.");
    } finally {
      await cleanup();
    }
  });
});
