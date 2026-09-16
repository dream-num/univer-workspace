import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from "react";
import { connectHtmlView, type HtmlViewHostOptions } from "./connection.js";

export interface WorkspaceHtmlViewerHandle {
  flush(): Promise<void>;
  hasPendingChanges(): boolean;
}

export interface WorkspaceHtmlViewerProps extends Pick<
  HtmlViewHostOptions,
  "loadEngine" | "onStatus" | "onError"
> {
  readonly source: string;
  readonly runtime: string;
  readonly title: string;
  readonly allowedOrigins?: readonly string[];
  readonly className?: string | undefined;
  readonly style?: CSSProperties;
}

/** Hosts keep this component mounted until flush succeeds, then own navigation and teardown. */
export const WorkspaceHtmlViewer = forwardRef<WorkspaceHtmlViewerHandle, WorkspaceHtmlViewerProps>(
  function WorkspaceHtmlViewer(props, ref) {
    const iframe = useRef<HTMLIFrameElement>(null);
    const connection = useRef<ReturnType<typeof connectHtmlView>>();
    const callbacks = useRef(props);
    callbacks.current = props;
    useImperativeHandle(
      ref,
      () => ({
        async flush() {
          await connection.current?.flush();
        },
        hasPendingChanges: () => connection.current?.hasPendingChanges() ?? false,
      }),
      [],
    );
    useEffect(() => {
      if (!iframe.current) return;
      callbacks.current.onError?.("");
      callbacks.current.onStatus?.([]);
      try {
        const current = connectHtmlView(iframe.current, {
          source: props.source,
          runtime: props.runtime,
          ...(props.allowedOrigins ? { allowedOrigins: props.allowedOrigins } : {}),
          loadEngine: props.loadEngine,
          onError: (message) => callbacks.current.onError?.(message),
          onStatus: (states) => callbacks.current.onStatus?.(states),
        });
        connection.current = current;
        return () => {
          current.dispose();
          if (connection.current === current) connection.current = undefined;
        };
      } catch (error) {
        // A failed replacement must not leave the previous page's scripts running.
        iframe.current.srcdoc = "";
        callbacks.current.onError?.(error instanceof Error ? error.message : String(error));
      }
    }, [props.source, props.runtime, props.allowedOrigins, props.loadEngine]);
    return (
      <iframe
        ref={iframe}
        title={props.title}
        className={props.className}
        style={props.style}
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
      />
    );
  },
);
