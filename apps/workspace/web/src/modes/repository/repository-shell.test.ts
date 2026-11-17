// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceShellProps } from "../shell.types";
import { RepositoryShell } from "./repository-shell";
import { spaceQueryOptions } from "../../features/spaces";

const { fetchSpace, fetchSession } = vi.hoisted(() => ({
  fetchSpace: vi.fn(),
  fetchSession: vi.fn(),
}));

vi.mock("../../features/auth", () => ({
  sessionQueryKey: ["session"],
  sessionQueryOptions: { queryKey: ["session"], queryFn: fetchSession },
}));
vi.mock("../../features/spaces", () => ({
  spaceQueryOptions: (id: string | undefined) => ({
    queryKey: ["spaces", "detail", id],
    queryFn: () => fetchSpace(id),
    enabled: id !== undefined,
  }),
}));
vi.mock("../../features/worktrees", () => ({ useWorktreeChangeFeed: () => {} }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Navigate: () => null,
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) =>
    createElement("a", { href: to, className }, children),
}));
vi.mock("../../shared/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../shared/ui", () => ({
  LoadingScreen: () => createElement("div", { "data-testid": "loading" }),
  MenuItem: () => null,
}));
vi.mock("../../features/account", () => ({
  AccountMenu: () => null,
  AccessTokensDialog: () => null,
  AppSettingsDialog: () => null,
  ProfileDialog: () => null,
  PasswordDialog: () => null,
  TrialNoticeDialog: () => null,
}));
vi.mock("../mode-settings", () => ({ ModeSettings: () => null }));
vi.mock("./shell/repository-masthead", () => ({
  RepositoryMasthead: () => createElement("div", { "data-testid": "repository" }),
}));
vi.mock("./shell/top-bar", () => ({
  // Preserve the second observer that used to restart the parent's failed query
  // whenever the pending guard unmounted and remounted this child.
  TopBar: ({ selectedSpaceId }: WorkspaceShellProps) => {
    useQuery(spaceQueryOptions(selectedSpaceId));
    return createElement("header");
  },
}));

let client: QueryClient;
let container: HTMLDivElement;
let root: Root;
let mounts: number;
let unmounts: number;

function DocumentContent() {
  useEffect(() => {
    mounts += 1;
    return () => { unmounts += 1; };
  }, []);
  return createElement("div", { "data-testid": "document" }, "Shared content");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  mounts = unmounts = 0;
  client = new QueryClient({ defaultOptions: { queries: {
    retry: 1, retryDelay: 10, staleTime: Infinity, gcTime: Infinity,
  } } });
  client.setQueryData(["session"], { authenticated: true, user: { id: "reader" } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flush(milliseconds = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

async function open(props: Omit<WorkspaceShellProps, "children">) {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(
      RepositoryShell, { ...props, children: createElement(DocumentContent) },
    )));
  });
  await flush();
}

it.each([false, true])("keeps authorized content mounted while optional Space metadata fails (immersive=%s)", async (immersive) => {
  const unavailable = Object.assign(new Error("Space unavailable"), { code: "NOT_FOUND" });
  let reject!: (error: Error) => void;
  fetchSpace.mockRejectedValue(unavailable).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await open({ selectedSpaceId: "private-space", contentMode: "editor", immersive });
  const document = container.querySelector('[data-testid="document"]');
  expect(document).not.toBeNull();
  expect(container.querySelector('[data-testid="loading"]')).toBeNull();
  expect(container.querySelector('[data-testid="repository"]')).toBeNull();

  await act(async () => { reject(unavailable); });
  await flush(20);
  await flush(20);
  expect(client.getQueryState(["spaces", "detail", "private-space"])?.status).toBe("error");
  expect(fetchSpace).toHaveBeenCalledTimes(2);
  await flush(5_000);
  expect(fetchSpace).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[data-testid="document"]')).toBe(document);
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
});

it.each([true, false])("offers one link home in place of the top bar only when immersive (immersive=%s)", async (immersive) => {
  fetchSpace.mockResolvedValue({ id: "space", type: "personal", name: "Personal" });
  await open({ selectedSpaceId: "space", selectedNodeId: "sheet", contentMode: "editor", immersive });
  const home = [...container.querySelectorAll('a[href="/home"]')];
  expect(home.map((link) => link.textContent)).toEqual(immersive ? ["home"] : []);
  expect(container.querySelectorAll("header").length).toBe(1);
  expect(container.querySelector('[data-testid="document"]')).not.toBeNull();
});

it("still waits for Space details on repository pages and renders them after success", async () => {
  let resolve!: (space: unknown) => void;
  fetchSpace.mockImplementation(() => new Promise((success) => { resolve = success; }));
  await open({ selectedSpaceId: "team-space" });
  expect(container.querySelector('[data-testid="loading"]')).not.toBeNull();
  expect(mounts).toBe(0);
  await act(async () => { resolve({ id: "team-space", type: "team", name: "Team" }); });
  await flush();
  expect(container.querySelector('[data-testid="repository"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="document"]')).not.toBeNull();
  expect(fetchSpace).toHaveBeenCalledTimes(1);
});

it("continues to wait for the session before rendering document content", async () => {
  client.removeQueries({ queryKey: ["session"] });
  fetchSession.mockImplementation(() => new Promise(() => {}));
  fetchSpace.mockResolvedValue({ id: "space", type: "team", name: "Team" });
  await open({ selectedSpaceId: "space", contentMode: "editor" });
  expect(container.querySelector('[data-testid="loading"]')).not.toBeNull();
  expect(mounts).toBe(0);
});
