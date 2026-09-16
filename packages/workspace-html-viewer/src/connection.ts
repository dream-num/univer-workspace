import { parseHtmlView } from "@univerjs-labs/html-view";
import { createBindingHost, createHtmlViewDocument } from "@univerjs-labs/html-view-renderer";

export type HtmlViewHostOptions = Parameters<typeof createBindingHost>[1];

/** One sandbox navigation and its Host. No authentication, routing or engine construction. */
export function connectHtmlView(
  iframe: HTMLIFrameElement,
  options: HtmlViewHostOptions & {
    source: string;
    runtime: string;
    allowedOrigins?: readonly string[];
  },
) {
  const connectionId = crypto.randomUUID();
  const template = parseHtmlView(options.source);
  const document = createHtmlViewDocument({
    template,
    runtime: options.runtime,
    connectionId,
    ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {}),
  }).replace(
    /<head(?:\s[^>]*)?>/i,
    // Permit submit events, but never native form navigation, including to an allowed CDN.
    '$&<meta http-equiv="Content-Security-Policy" content="form-action \'none\'">',
  );
  let disposed = false;
  let host: ReturnType<typeof createBindingHost> | undefined;
  const connect = (event: MessageEvent) => {
    if (
      disposed ||
      event.source !== iframe.contentWindow ||
      event.origin !== "null" ||
      event.data?.type !== "univer-html-view-connect" ||
      event.data.token !== connectionId ||
      !event.ports[0]
    )
      return;
    if (host) {
      event.ports[0].close();
      return;
    }
    host = createBindingHost(event.ports[0], {
      loadEngine: options.loadEngine,
      ...(options.onStatus ? { onStatus: options.onStatus } : {}),
      ...(options.onError ? { onError: options.onError } : {}),
      onClose() {
        host = undefined;
        options.onClose?.();
      },
    });
  };
  window.addEventListener("message", connect);
  // StrictMode may dispose this effect before its navigation starts.
  queueMicrotask(() => {
    if (!disposed) iframe.srcdoc = document;
  });
  return {
    async flush() {
      await host?.flush();
    },
    hasPendingChanges: () => host?.hasPendingChanges() ?? false,
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("message", connect);
      host?.dispose();
      host = undefined;
    },
  };
}
