import type { BindingEngineOptions } from "@univerjs-labs/binding-engine";
import type { ComponentProps } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceHtmlViewer } from "@univerjs/univer-workspace-html-viewer";

const mocks = await vi.hoisted(async () => {
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  // Mock the shared factory's own peer context through its public ESM exports.
  const resolvePeer = (name: string) => fileURLToPath(execFileSync(process.execPath, [
    "--experimental-import-meta-resolve", "--input-type=module", "-e",
    "console.log(import.meta.resolve(process.argv[1], process.argv[2]))", name,
    import.meta.resolve("@univerjs/univer-workspace-html-viewer/engine"),
  ], { encoding: "utf8" }).trim());
  vi.stubGlobal("window", { location: { origin: "https://workspace.test" } });
  vi.stubGlobal("location", { protocol: "https:", host: "workspace.test", origin: "https://workspace.test" });
  return { core: resolvePeer("@univerjs/core"), facade: resolvePeer("@univerjs/core/facade"),
    binding: resolvePeer("@univerjs-labs/binding-engine"),
    collaborationUI: resolvePeer("@univerjs-pro/collaboration-client-ui"), bridge: vi.fn((source: string) => source + "<!-- native bridge -->"), GET: vi.fn(), POST: vi.fn(), render: vi.fn(), cell: vi.fn(), flush: vi.fn(), editable: vi.fn(),
    service: { setCurrentUser: vi.fn(), dispose: vi.fn(), updatePermissionPoint: vi.fn() } };
});
vi.mock("../../shared/api/client", () => ({ api: { GET: mocks.GET, POST: mocks.POST } }));
vi.mock("../../shared/i18n", () => ({ useI18n: () => ({ language: "en-US", t: (key: string) => key }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: { authenticated: true, user: { id: "owner", displayName: "Owner" } } }) }));
vi.mock("@tanstack/react-router", () => ({ useBlocker: vi.fn() }));
vi.mock("../auth", () => ({ sessionQueryOptions: {}, anonymousUser: {} }));
vi.mock("../editor", () => ({ withWorkspaceSnapshotServerOverride: () => [], resolveUniverLicense: () => "" }));
vi.mock("../editor/preview", () => ({ NATIVE_PREVIEW_CHANNEL: "native-preview" }));
vi.mock("@univerjs/univer-workspace-html-viewer", () => ({ WorkspaceHtmlViewer: mocks.render }));
vi.mock(mocks.core, async (original) => ({
  ...await original<typeof import("@univerjs/core")>(),
  Univer: class {
    registerPlugin() {}
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
vi.mock("./native-preview-client", () => ({ withNativePreviewClient: mocks.bridge }));
import { HtmlView } from "./html-view";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.GET.mockResolvedValue({ data: { resource: { id: "resource" } } });
  mocks.POST.mockResolvedValue({ data: { resource: { kind: "univer", unitType: "sheet", unitId: "unit", editorMode: "edit" } } });
  mocks.render.mockImplementation((props: ComponentProps<typeof WorkspaceHtmlViewer>) => createElement("div", { "data-source": props.source }));
});

it.each([true, false])("renders draft=%s with the real engine's write policy and native bridge isolation", async (draft) => {
  const source = "<!doctype html><html><body>Draft page</body></html>";
  const markup = renderToStaticMarkup(createElement(HtmlView, { source, draft, immersive: true, actionsContainer: null }));
  const props: ComponentProps<typeof WorkspaceHtmlViewer> = mocks.render.mock.calls[0]![0];
  expect(props.source === source).toBe(draft);
  expect(mocks.bridge).toHaveBeenCalledTimes(draft ? 0 : 1);
  if (draft) expect(markup).toContain("htmlViewDraftNotice");
  const engine = await props.loadEngine("unit", new AbortController().signal);
  expect(engine).toMatchObject({ writeMode: draft ? "trial" : "saved" });
  engine.setCellValue({ sheetId: "sheet", row: 0, col: 0 }, 5);
  await engine.flush();
  expect(mocks.cell).toHaveBeenCalledTimes(1);
  expect(mocks.flush).toHaveBeenCalledTimes(draft ? 0 : 1);
  expect(mocks.service.dispose).toHaveBeenCalledTimes(draft ? 2 : 0);
  engine.dispose();
});
