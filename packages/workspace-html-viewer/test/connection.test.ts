import { beforeEach, expect, it, vi } from "vitest";
import type {
  BindingInspectOptions,
  HtmlViewState,
  RenderHtmlViewOptions,
} from "@univerjs-labs/html-view-renderer/render";
import { CollaborationStatus } from "@univerjs-pro/collaboration-client";
import { connectHtmlView, type HtmlViewEngine } from "../src/connection.js";

const sdk = vi.hoisted(() => ({
  view: {
    flush: vi.fn(),
    prepareToLeave: vi.fn(),
    resume: vi.fn(),
    dispose: vi.fn(),
    subscribe: vi.fn(),
    inspect: { open: vi.fn(), close: vi.fn() },
  },
  unsubscribe: vi.fn(),
  renderHtmlView: vi.fn(),
}));
vi.mock("@univerjs-labs/html-view-renderer/render", () => ({ renderHtmlView: sdk.renderHtmlView }));
const container = {} as HTMLElement;
const loadEngine = vi.fn();
const signal = () => new AbortController().signal;
const renderOptions = () => sdk.renderHtmlView.mock.calls[0]![0] as RenderHtmlViewOptions;
const metadataLoader = () =>
  (sdk.view.inspect.open.mock.calls[0]![0] as BindingInspectOptions).loadMetadata!;
const state = (patch: Partial<HtmlViewState> = {}): HtmlViewState => ({
  phase: "ready",
  inspecting: false,
  pending: { drafts: false, writes: false, confirmation: false },
  sources: [],
  ...patch,
});
beforeEach(() => {
  vi.resetAllMocks();
  sdk.renderHtmlView.mockReturnValue(sdk.view);
  sdk.view.subscribe.mockReturnValue(sdk.unsubscribe);
});
it("passes HTML, locale and origin policy to the SDK and translates errors", () => {
  const onError = vi.fn();
  connectHtmlView(container, {
    source: "template",
    locale: "zh-CN",
    allowedOrigins: ["https://cdn.jsdelivr.net"],
    loadEngine,
    onError,
  });
  expect(renderOptions()).toMatchObject({
    container,
    html: "template",
    locale: "zh-CN",
    policy: { allowedOrigins: ["https://cdn.jsdelivr.net"] },
  });
  renderOptions().onError!(new Error("source unavailable"));
  expect(onError).toHaveBeenCalledWith("source unavailable");
});
it("derives unload protection and inspection state from SDK state, without repeated inspect callbacks", () => {
  const onStatus = vi.fn();
  const onInspectChanged = vi.fn();
  const connection = connectHtmlView(container, {
    source: "template",
    loadEngine,
    onStatus,
    onInspectChanged,
  });
  const notify = sdk.view.subscribe.mock.calls[0]![0] as (state: HtmlViewState) => void;
  expect(connection.hasPendingChanges()).toBe(false);
  notify(
    state({
      inspecting: true,
      pending: { drafts: true, writes: false, confirmation: false },
      sources: [
        { unitId: "a", phase: "loading" },
        { unitId: "b", phase: "ready", status: CollaborationStatus.SYNCED },
      ],
    }),
  );
  expect(connection.hasPendingChanges()).toBe(true);
  expect(onStatus).toHaveBeenLastCalledWith([CollaborationStatus.SYNCED]);
  notify(
    state({ inspecting: true, pending: { drafts: false, writes: false, confirmation: true } }),
  );
  expect(connection.hasPendingChanges()).toBe(true);
  expect(onInspectChanged.mock.calls).toEqual([[false], [true]]);
  notify(state());
  expect(connection.hasPendingChanges()).toBe(false);
  expect(onInspectChanged).toHaveBeenLastCalledWith(false);
});
it("inspects the same authorized engine, including an in-flight load, without loading another engine", async () => {
  let finish!: (engine: HtmlViewEngine) => void;
  loadEngine.mockReturnValue(
    new Promise<HtmlViewEngine>((resolve) => {
      finish = resolve;
    }),
  );
  const connection = connectHtmlView(container, { source: "template", loadEngine });
  const loading = renderOptions().loadEngine("unit", signal());
  await connection.inspect.open();
  const reading = metadataLoader()("unit", signal());
  const metadata = {
    unitId: "unit",
    name: "Budget",
    sheets: [{ sheetId: "sheet", name: "Summary" }],
  };
  const getMetadata = vi.fn(() => metadata);
  finish({ getMetadata } as unknown as HtmlViewEngine);
  await loading;
  await expect(reading).resolves.toEqual(metadata);
  expect(loadEngine).toHaveBeenCalledOnce();
  expect(getMetadata).toHaveBeenCalledOnce();
  await expect(metadataLoader()("unknown", signal())).resolves.toEqual({
    unitId: "unknown",
    sheets: [],
  });
  expect(loadEngine).toHaveBeenCalledOnce();
});
it("does not read metadata after inspect cancellation or view disposal", async () => {
  const getMetadata = vi.fn();
  loadEngine.mockResolvedValue({ getMetadata });
  const connection = connectHtmlView(container, { source: "template", loadEngine });
  await renderOptions().loadEngine("unit", signal());
  await connection.inspect.open();
  const abort = new AbortController();
  const reading = metadataLoader()("unit", abort.signal);
  abort.abort();
  await expect(reading).rejects.toThrow();
  const disposedReading = metadataLoader()("unit", signal());
  connection.dispose();
  await expect(disposedReading).rejects.toThrow("disposed");
  expect(getMetadata).not.toHaveBeenCalled();
});
it("keeps failed saves recoverable and releases only the SDK-owned view once", async () => {
  const connection = connectHtmlView(container, { source: "template", loadEngine });
  sdk.view.prepareToLeave.mockRejectedValueOnce(new Error("offline"));
  await expect(connection.prepareToLeave()).rejects.toThrow("offline");
  expect(sdk.view.dispose).not.toHaveBeenCalled();
  await connection.prepareToLeave();
  await connection.resume();
  await connection.flush();
  await connection.inspect.close();
  expect(sdk.view.resume).toHaveBeenCalledOnce();
  expect(sdk.view.flush).toHaveBeenCalledOnce();
  expect(sdk.view.inspect.close).toHaveBeenCalledOnce();
  connection.dispose();
  connection.dispose();
  expect(sdk.unsubscribe).toHaveBeenCalledOnce();
  expect(sdk.view.dispose).toHaveBeenCalledOnce();
});
