import type { ViewerLocale } from "../viewer-locale.ts";
import { useEffect, useRef, useState } from "react";
import { loadViewerBootstrap } from "../viewer-bootstrap.ts";
import type { UniverLocaleKey } from "../locales.ts";
import { mountRetainedHtmlView } from "./retained-preview.tsx";
import { createAgentBindingEngine } from "./binding-engine.ts";

export function WorkspaceHtmlFile(props: {
  contentUrl: string;
  name: string;
  locale: ViewerLocale;
  canInspect: boolean;
  t: (key: UniverLocaleKey) => string;
}) {
  const locale = useRef(props.locale);
  locale.current = props.locale;
  const translation = useRef(props.t);
  translation.current = props.t;
  const anchor = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    let release: (() => void) | undefined;
    setError("");
    void Promise.all([
      fetch(props.contentUrl, { signal: abort.signal, credentials: "same-origin" }).then(
        (response) => {
          if (!response.ok) throw new Error(`HTML view could not be loaded (${response.status}).`);
          return response.text();
        },
      ),
      loadViewerBootstrap(),
    ])
      .then(([source, bootstrap]) => {
        if (abort.signal.aborted || !anchor.current) return;
        release = mountRetainedHtmlView({
          anchor: anchor.current,
          source,
          name: props.name,
          locale: locale.current,
          canInspect: props.canInspect,
          t: (key) => translation.current(key),
          loadEngine: (unitId, signal) =>
            createAgentBindingEngine(unitId, bootstrap, signal, (code) =>
              translation.current(
                code === "signInRequired" ? "html.signInRequired" : "html.editPermissionRequired",
              ),
            ),
        });
      })
      .catch((reason: unknown) => {
        if (!abort.signal.aborted)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      abort.abort();
      release?.();
    };
  }, [props.contentUrl, props.name]);
  return (
    <div ref={anchor} style={{ width: "100%", height: "100%", minHeight: 0 }}>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
