// @vitest-environment jsdom
import type { BindingEngineOptions } from "@univerjs-labs/binding-engine";
import type { ComponentProps } from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceHtmlViewer } from "@univerjs/univer-workspace-html-viewer";
import { LanguageProvider } from "../../shared/i18n";
import { HTML_PREVIEW_CHANNEL } from "./native-preview-protocol";

const mocks = await vi.hoisted(async () => {
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  // Mock the shared factory's own peer context through its public ESM exports.
  const resolvePeer = (name: string) => fileURLToPath(execFileSync(process.execPath, [
    "--experimental-import-meta-resolve", "--input-type=module", "-e",
    "console.log(import.meta.resolve(process.argv[1], process.argv[2]))", name,
    import.meta.resolve("@univerjs/univer-workspace-html-viewer/engine"),
  ], { encoding: "utf8" }).trim());
  return { core: resolvePeer("@univerjs/core"), facade: resolvePeer("@univerjs/core/facade"),
    binding: resolvePeer("@univerjs-labs/binding-engine"),
    collaborationUI: resolvePeer("@univerjs-pro/collaboration-client-ui"), bridge: vi.fn((source: string, _nonce: string, _nativePreview: boolean) => source + "<!-- navigation bridge -->"), GET: vi.fn(), POST: vi.fn(), collaboration: vi.fn(), override: vi.fn(), reference: vi.fn(), render: vi.fn(), cell: vi.fn(), flush: vi.fn(), editable: vi.fn(),
    service: { setCurrentUser: vi.fn(), dispose: vi.fn(), updatePermissionPoint: vi.fn() }, plugins: [] as unknown[] };
});
vi.mock("../../shared/api/client", () => ({ api: { GET: mocks.GET, POST: mocks.POST } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: { authenticated: true, user: { id: "owner", displayName: "Owner" } } }) }));
vi.mock("@tanstack/react-router", () => ({ useBlocker: vi.fn() }));
vi.mock("../auth", () => ({ sessionQueryOptions: {}, anonymousUser: {} }));
vi.mock("../editor", () => ({ withWorkspaceSnapshotServerOverride: mocks.override, resolveUniverLicense: () => "", resolveCollaborationConfig: mocks.collaboration }));
vi.mock("../editor/preview", () => ({ NATIVE_PREVIEW_CHANNEL: "native-preview" }));
vi.mock("@univerjs/univer-workspace-html-viewer", () => ({ WorkspaceHtmlViewer: mocks.render }));
vi.mock(mocks.core, async (original) => ({
  ...await original<typeof import("@univerjs/core")>(),
  Univer: class {
    registerPlugin(_plugin: unknown, config?: unknown) { mocks.plugins.push(config); }
    __getInjector() { return { add() {}, get: () => mocks.service }; }
    dispose() {}
  },
}));
vi.mock(mocks.facade, async (original) => {
  const actual = await original<typeof import("@univerjs/core/facade")>();
  return { ...actual, FUniver: class {
    static extend = actual.FUniver.extend.bind(actual.FUniver);
    static newAPI() { return { getWorkbook: () => ({ setEditable: mocks.editable }) }; }
  } };
});
vi.mock(mocks.collaborationUI, () => ({ BrowserCollaborationSocketService: class {} }));
vi.mock(mocks.binding, () => ({ BindingEngine: class {
  constructor(private readonly options: BindingEngineOptions) {}
  async load() { this.options.createUniver?.(this.options.collaborationClientConfig); }
  dispose() {}
  setCellValue(...args: unknown[]) { mocks.cell(...args); }
  flush() { mocks.flush(); }
} }));
vi.mock("@univerjs/univer-workspace-reference-provider", () => ({ createWorkspaceReferencedUnitProviderRegistration: mocks.reference }));
vi.mock("./native-preview-client", () => ({ withNativePreviewClient: mocks.bridge }));
import { HtmlView } from "./html-view";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.plugins.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.setItem("univer-workspace-language", "en-US");
  mocks.override.mockReturnValue([]);
  mocks.collaboration.mockImplementation(async (scope) => ({ pluginConfig: {}, hostSnapshotScope: scope }));
  mocks.GET.mockResolvedValue({ data: { resource: { id: "resource" } } });
  mocks.POST.mockResolvedValue({ data: { resource: { kind: "univer", unitType: "sheet", unitId: "unit", editorMode: "edit" } } });
  mocks.render.mockImplementation((props: ComponentProps<typeof WorkspaceHtmlViewer>) => createElement("div", { "data-source": props.source }));
});

it.each([true, false])("renders draft=%s with the real engine's write policy and native bridge isolation", async (draft) => {
  const source = "<!doctype html><html><body>Draft page</body></html>";
  const markup = renderToStaticMarkup(createElement(LanguageProvider, null,
    createElement(HtmlView, { source, draft, immersive: true, actionsContainer: null })));
  const props: ComponentProps<typeof WorkspaceHtmlViewer> = mocks.render.mock.calls[0]![0];
  expect(props.source).toBe(mocks.bridge.mock.results[0]!.value);
  expect(mocks.bridge).toHaveBeenCalledWith(source, expect.any(String), !draft);
  if (draft) expect(markup).toContain("Draft, not published. Preview changes are not saved.");
  const engine = await props.loadEngine("unit", new AbortController().signal);
  expect(engine).toMatchObject({ writeMode: draft ? "trial" : "saved" });
  engine.setCellValue({ sheetId: "sheet", row: 0, col: 0 }, 5);
  await engine.flush();
  expect(mocks.cell).toHaveBeenCalledTimes(1);
  expect(mocks.flush).toHaveBeenCalledTimes(draft ? 0 : 1);
  expect(mocks.service.dispose).toHaveBeenCalledTimes(draft ? 2 : 0);
  engine.dispose();
});

it("opens only activated external web links from the focused viewer and current source", async () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  const activation = { isActive: false };
  Object.defineProperty(navigator, "userActivation", { configurable: true, value: activation });
  mocks.render.mockImplementation(() => createElement("iframe"));
  try {
    await act(async () => root.render(createElement(LanguageProvider, null,
      createElement(HtmlView, { source: "<p>Links</p>", draft: true, immersive: false, actionsContainer: null }))));
    const frame = container.querySelector("iframe")!;
    const nonce = mocks.bridge.mock.lastCall![1];
    const href = "https://example.org/report?file=1#summary";
    const send = (url: string, generation = nonce, sender = frame.contentWindow) =>
      window.dispatchEvent(new MessageEvent("message", { source: sender, data: {
        channel: HTML_PREVIEW_CHANNEL, nonce: generation, action: "open-external-link", href: url,
      } }));
    frame.focus();
    send(href);
    activation.isActive = true;
    send(href, "previous-source");
    send(href, nonce, window);
    for (const url of ["#section", location.href, "data:text/plain,Hello", "javascript:void(0)"]) send(url);
    frame.blur();
    send(href);
    expect(open).not.toHaveBeenCalled();
    frame.focus();
    send(href);
    expect(open).toHaveBeenCalledExactlyOnceWith(href, "_blank", "noopener,noreferrer");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(navigator, "userActivation");
    open.mockRestore();
  }
});

it.each([
  ["en-US", "The source must be an accessible Sheet."],
  ["zh-CN", "来源必须是可访问的 Sheet。"],
])("shows an invalid source error in the %s page banner", async (language, message) => {
  window.localStorage.setItem("univer-workspace-language", language);
  mocks.POST.mockResolvedValue({ data: { resource: { kind: "univer", unitType: "doc", unitId: "unit" } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(LanguageProvider, null,
      createElement(HtmlView, { source: "<p>Page</p>", immersive: true, actionsContainer: null }))));
    const props: ComponentProps<typeof WorkspaceHtmlViewer> = mocks.render.mock.lastCall![0];
    await act(async () => {
      await props.loadEngine("unit", new AbortController().signal).catch((error: unknown) => {
        if (!(error instanceof Error)) throw error;
        props.onError?.(error.message);
      });
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect(mocks.cell).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

it("preserves other source loading errors", async () => {
  const failure = new Error("Resource access was revoked.");
  mocks.GET.mockRejectedValueOnce(failure);
  renderToStaticMarkup(createElement(LanguageProvider, null,
    createElement(HtmlView, { source: "<p>Page</p>", immersive: true, actionsContainer: null })));
  const props: ComponentProps<typeof WorkspaceHtmlViewer> = mocks.render.mock.lastCall![0];
  await expect(props.loadEngine("unit", new AbortController().signal)).rejects.toBe(failure);
});


it.each([
  { state: "ready", mapped: true, draft: true, worktree: true },
  { state: "draft", mapped: true, draft: true, worktree: true },
  { state: "ready", mapped: false, draft: true, worktree: false },
  { state: "merged", mapped: true, draft: true, worktree: false },
  { state: "ready", mapped: true, draft: false, worktree: false },
] as const)("resolves preview source $state mapped=$mapped draft=$draft", async ({ state, mapped, draft, worktree }) => {
  const sourceWorktree: NonNullable<ComponentProps<typeof HtmlView>["sourceWorktree"]> = {
    id: "pr-3", state,
    units: mapped ? [{ unitId: "unit", resourceId: "local-resource", nodeId: null, name: "New Sheet", unitType: "sheet",
      source: "worktree", target: null, draftHeadRevision: 1, change: "added", mergeResult: "pending", activationState: "waitingForMerge",
      freshness: null, fileState: null }] : [],
  };
  if (worktree) mocks.POST.mockResolvedValue({ data: { unit: { unitId: "unit", unitType: "sheet", editorMode: "edit" }, collaborationScope: { kind: "worktree", worktreeId: "pr-3" } } });
  renderToStaticMarkup(createElement(LanguageProvider, null,
    createElement(HtmlView, { source: "<p>PR page</p>", sourceWorktree, draft, immersive: true, actionsContainer: null })));
  const props: ComponentProps<typeof WorkspaceHtmlViewer> = mocks.render.mock.lastCall![0];
  const engine = await props.loadEngine("unit", new AbortController().signal);
  const scope = worktree ? { kind: "worktree", worktreeId: "pr-3" } : { kind: "trunk" };
  expect(mocks.collaboration).toHaveBeenCalledWith(scope, "unit");
  expect(mocks.override).toHaveBeenCalledWith(undefined, expect.objectContaining({ hostScope: scope }));
  expect(mocks.reference).toHaveBeenCalledWith(expect.objectContaining({
    hostContext: draft && state !== "merged"
      ? { view: { kind: "worktree", worktreeId: "pr-3" }, mappedUnitIds: mapped ? ["unit"] : [] }
      : { view: { kind: "trunk" } },
  }));
  if (worktree) {
    expect(mocks.GET).not.toHaveBeenCalled();
    expect(mocks.POST).toHaveBeenCalledWith("/api/worktrees/{worktreeId}/units/{unitId}/open", expect.objectContaining({
      params: { path: { worktreeId: "pr-3", unitId: "unit" } }, body: { mode: "draft" },
    }));
  } else expect(mocks.GET).toHaveBeenCalledWith("/api/unit-resources/{unitId}", expect.anything());
  expect(engine).toMatchObject({ writeMode: draft ? "trial" : "saved" });
  engine.dispose();
});

it("loads only declared Units for a reader who did not write the page and tells them what it refused", async () => {
  type Reference = { readonly ref: { readonly unit: { readonly selector: string } } };
  const ensureUnit = vi.fn(async (input: Reference) => ({ unitId: input.ref.unit.selector }));
  mocks.reference.mockReturnValue({ registrationId: "references", provider: { ensureUnit } });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(LanguageProvider, null,
      createElement(HtmlView, { source: "<p>Someone else's page</p>", draft: true, allowedUnitIds: ["unit"], immersive: true, actionsContainer: null }))));
    const props: ComponentProps<typeof WorkspaceHtmlViewer> = mocks.render.mock.lastCall![0];
    await act(async () => {
      await expect(props.loadEngine("private-sheet", new AbortController().signal)).rejects.toThrow("This preview loads only the Sheets the page declares.");
    });
    expect(mocks.GET).not.toHaveBeenCalled();
    expect(mocks.POST).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("The page asked for data it does not declare. The preview refused: private-sheet");

    const engine = await props.loadEngine("unit", new AbortController().signal);
    expect(engine).toMatchObject({ writeMode: "trial" });
    const embed = mocks.plugins.find((config) => config && typeof config === "object" && "resourceRefUnitProviderRegistrations" in config) as {
      readonly resourceRefUnitProviderRegistrations: readonly { readonly provider: { ensureUnit(input: Reference): Promise<unknown> } }[];
    };
    const references = embed.resourceRefUnitProviderRegistrations[0]!.provider;
    await act(async () => {
      await expect(references.ensureUnit({ ref: { unit: { selector: "other-sheet" } } })).rejects.toThrow();
    });
    expect(ensureUnit).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("private-sheet, other-sheet");
    await expect(references.ensureUnit({ ref: { unit: { selector: "unit" } } })).resolves.toEqual({ unitId: "unit" });
    engine.dispose();
  } finally {
    await act(async () => root.unmount());
  }
});
