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
}

/** Adapts SDK state and authorized workbook metadata to the React consumers. */
export function connectHtmlView(
  container: HTMLElement,
  options: HtmlViewHostOptions & {
    source: string;
    locale?: HtmlViewLocale;
    allowedOrigins?: readonly string[];
  },
) {
  const engines = new Map<string, Promise<HtmlViewEngine>>();
  const view = renderHtmlView({
    container,
    html: options.source,
    ...(options.locale ? { locale: options.locale } : {}),
    ...(options.allowedOrigins ? { policy: { allowedOrigins: options.allowedOrigins } } : {}),
    loadEngine(unitId, signal) {
      const loading = options.loadEngine(unitId, signal);
      engines.set(unitId, loading);
      return loading;
    },
    onError: (error) => options.onError?.(error.message),
  });
  let disposed = false;
  let pending = false;
  let inspecting = false;
  options.onInspectChanged?.(false);
  const unsubscribe = view.subscribe((state) => {
    pending = state.pending.drafts || state.pending.writes || state.pending.confirmation;
    options.onStatus?.(
      state.sources.flatMap((source) => (source.status === undefined ? [] : [source.status])),
    );
    if (state.inspecting !== inspecting) {
      inspecting = state.inspecting;
      options.onInspectChanged?.(inspecting);
    }
  });
  return {
    flush: () => view.flush(),
    prepareToLeave: () => view.prepareToLeave(),
    resume: () => view.resume(),
    hasPendingChanges: () => pending,
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
      close: () => view.inspect.close(),
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      view.dispose();
      engines.clear();
    },
  };
}
