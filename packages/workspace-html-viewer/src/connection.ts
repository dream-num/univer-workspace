import { getHtmlViewUnitIds, parseHtmlView } from "@univerjs-labs/html-view";
import {
  renderHtmlView,
  type BindingEnginePort,
  type BindingUnitMetadata,
  type HtmlViewLocale,
} from "@univerjs-labs/html-view-renderer/render";
import type { CollaborationStatus } from "@univerjs-pro/collaboration-client";

/** Metadata comes from the same authorized workbook used for binding reads and writes. */
export type HtmlViewEngine = BindingEnginePort & {
  getMetadata?: () => BindingUnitMetadata;
};

export interface HtmlViewHostOptions {
  loadEngine: (unitId: string, signal: AbortSignal) => Promise<HtmlViewEngine>;
  onError?: (message: string) => void;
  onStatus?: (states: readonly CollaborationStatus[]) => void;
  onInspectChanged?: (inspecting: boolean) => void;
  onLoadingChanged?: (loading: boolean) => void;
}

// A frame whose CDN never answers never fires load. This covers a slow CDN stylesheet; past it the person sees what the frame has.
const FRAME_LOAD_LIMIT_MS = 10_000;

/** Adapts SDK state and authorized workbook metadata to the React consumers. */
export function connectHtmlView(
  container: HTMLElement,
  options: HtmlViewHostOptions & {
    source: string;
    locale?: HtmlViewLocale;
    allowedOrigins?: readonly string[];
    mediaSources?: readonly string[];
  },
) {
  const engines = new Map<string, Promise<HtmlViewEngine>>();
  const view = renderHtmlView({
    container,
    html: options.source,
    ...(options.locale ? { locale: options.locale } : {}),
    policy: {
      ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {}),
      ...(options.mediaSources ? { mediaSources: options.mediaSources } : {}),
    },
    loadEngine(unitId, signal) {
      const loading = options.loadEngine(unitId, signal);
      engines.set(unitId, loading);
      return loading;
    },
    onError: (error) => options.onError?.(error.message),
  });
  let disposed = false;
  let pending = false;
  let localChanges = false;
  // Confirmation alone is indistinguishable from an untouched offline page, so latch
  // that an edit was seen until the SDK reports nothing pending.
  let edited = false;
  let inspecting = false;
  options.onInspectChanged?.(false);
  // The frame asks for its Sheets only after it has parsed, which its own scripts and stylesheets can delay.
  const declaresSources = getHtmlViewUnitIds(parseHtmlView(options.source)).length > 0;
  let loading = true;
  let sourcesSettled = false;
  // A stylesheet the page's <head> waits for keeps the frame blank after its Sheets load; the frame's load event waits for it too.
  const frame = findFrame(container);
  let frameLoaded = frame === null;
  const onFrameLoad = () => {
    frameLoaded = true;
    endLoading();
  };
  frame?.addEventListener("load", onFrameLoad, { once: true });
  const frameLimit = setTimeout(onFrameLoad, FRAME_LOAD_LIMIT_MS);
  const stopWaitingForFrame = () => {
    clearTimeout(frameLimit);
    frame?.removeEventListener("load", onFrameLoad);
  };
  function endLoading() {
    if (!loading || !sourcesSettled || !frameLoaded) return;
    loading = false;
    stopWaitingForFrame();
    options.onLoadingChanged?.(false);
  }
  options.onLoadingChanged?.(true);
  const unsubscribe = view.subscribe((state) => {
    const { drafts, writes, confirmation } = state.pending;
    if (drafts || writes) edited = true;
    else if (!confirmation) edited = false;
    localChanges = drafts || writes || (edited && confirmation);
    pending = localChanges || confirmation;
    options.onStatus?.(
      state.sources.flatMap((source) => (source.status === undefined ? [] : [source.status])),
    );
    if (state.inspecting !== inspecting) {
      inspecting = state.inspecting;
      options.onInspectChanged?.(inspecting);
    }
    // Loading ends once, so a Sheet the page asks for later never covers a page already in use.
    sourcesSettled = state.phase !== "connecting" && !(state.phase === "ready" && declaresSources &&
      (state.sources.length === 0 || state.sources.some((source) => source.phase === "loading")));
    // A closed connection shows its error, not a page, so there is no paint to wait for.
    if (state.phase === "closed") frameLoaded = true;
    endLoading();
  });
  return {
    prepareToLeave: view.prepareToLeave,
    resume: view.resume,
    hasPendingChanges: () => pending,
    hasLocalChanges: () => localChanges,
    inspect: {
      open: () =>
        view.inspect.open({
          async loadMetadata(unitId, signal) {
            signal.throwIfAborted();
            // Never create a second engine or bypass source authorization for inspection.
            const engine = await engines.get(unitId);
            signal.throwIfAborted();
            if (disposed) throw new Error("HTML view is disposed.");
            return engine?.getMetadata?.() ?? { unitId, sheets: [] };
          },
        }),
      close: view.inspect.close,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopWaitingForFrame();
      unsubscribe();
      view.dispose();
      engines.clear();
    },
  };
}

function findFrame(root: ParentNode | null): HTMLIFrameElement | null {
  for (const child of root?.children ?? []) {
    if (child instanceof HTMLIFrameElement) return child;
    const found = findFrame(child.shadowRoot) ?? findFrame(child);
    if (found) return found;
  }
  return null;
}
