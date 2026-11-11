import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionQueryKey } from "../features/auth";
import { LanguageProvider } from "../shared/i18n";
import { WorkspaceLayout } from "./workspace-layout";

const { controls } = vi.hoisted(() => ({ controls: new Map<string, () => unknown>() }));
const href = "/nodes/one?view=immersive#chart";

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ href: "/nodes/one?view=immersive#chart" }),
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
  useModeDefinition: () => ({ Shell: () => createElement("div", null, "Signed-in shell") }),
}));
vi.mock("../features/shell", () => ({ WorkspaceHeaderSearch: () => null }));
vi.mock("../features/spaces", () => ({ CreateTeamDialog: () => null }));
vi.mock("../shared/ui-mode", () => ({ useUiMode: () => ({ mode: "repository" }) }));
vi.mock("../shared/ui", async () => {
  const { Button, buttonVariants } = await import("../shared/ui/button");
  return {
    buttonVariants,
    LoadingScreen: () => null,
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

function renderLayout(authenticated = false, immersive = true) {
  controls.clear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  client.setQueryData(sessionQueryKey, { authenticated });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(LanguageProvider, null,
      createElement(WorkspaceLayout, { immersive }, createElement("iframe", { title: "Shared app" })),
    ),
  ));
}

describe("visitor sign-up bar", () => {
  it("renders outside the iframe after the main area for signed-out immersive visitors", () => {
    const html = renderLayout();
    expect(html).toContain("Made with Univer Workspace");
    expect(html).toContain("Sign up free");
    expect(html).toContain("Copy link");
    expect(html.indexOf("</main>")).toBeLessThan(html.indexOf("<footer"));
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
    expect(collapsed).toContain('aria-label="Expand sign-up bar"');
    expect(collapsed).not.toContain("Sign up free");
    controls.get("Expand sign-up bar")?.();
    expect([...storage.values()]).toEqual(["false"]);
    expect(renderLayout()).toContain("Sign up free");
  });

  it("offers both authentication links in the non-immersive header", () => {
    const header = renderLayout(false, false).split("</header>")[0] ?? "";
    expect(header).toContain(">Sign up</a>");
    expect(header).toContain(">Sign in</a>");
    expect(header).toContain(`href="/login?mode=register&amp;returnTo=${encodeURIComponent(href)}"`);
  });

  it("never renders the bar for signed-in users", () => {
    expect(renderLayout(true)).toContain("Signed-in shell");
    expect(renderLayout(true)).not.toContain("<footer");
    expect(renderLayout(true)).not.toContain("Sign up free");
  });

  it("copies the full current URL and handles clipboard failure", async () => {
    renderLayout();
    await controls.get("copy")?.();
    expect(writeText).toHaveBeenCalledWith(`https://workspace.example${href}`);
    writeText.mockRejectedValueOnce(new Error("Clipboard denied"));
    await expect(controls.get("copy")?.()).resolves.toBeUndefined();
  });

  it("still renders and collapses when sessionStorage is unavailable", () => {
    Object.defineProperty(window, "sessionStorage", { get: () => { throw new Error("Storage denied"); } });
    expect(renderLayout()).toContain("Sign up free");
    expect(() => controls.get("Collapse sign-up bar")?.()).not.toThrow();
  });
});
