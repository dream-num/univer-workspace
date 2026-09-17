import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from "react";
import { connectHtmlView, type HtmlViewHostOptions } from "./connection.js";

export interface WorkspaceHtmlViewerHandle {
  flush(): Promise<void>;
  prepareToLeave(): Promise<void>;
  resume(): Promise<void>;
  inspect: { open(): Promise<void>; close(): Promise<void> };
  hasPendingChanges(): boolean;
}

export interface WorkspaceHtmlViewerProps extends Pick<
  HtmlViewHostOptions,
  "loadEngine" | "onStatus" | "onError" | "onInspectChanged"
> {
  readonly source: string;
  /** Applied when mounting a page; language changes do not discard a live page. */
  readonly locale?: "zh-CN" | "en-US";
  readonly title: string;
  readonly allowedOrigins?: readonly string[];
  readonly className?: string | undefined;
  readonly style?: CSSProperties;
}

/** Hosts keep this component mounted until prepareToLeave succeeds, then own navigation and teardown. */
export const WorkspaceHtmlViewer = forwardRef<WorkspaceHtmlViewerHandle, WorkspaceHtmlViewerProps>(
  function WorkspaceHtmlViewer(props, ref) {
    const container = useRef<HTMLDivElement>(null);
    const connection = useRef<ReturnType<typeof connectHtmlView>>();
    const callbacks = useRef(props);
    callbacks.current = props;
    useImperativeHandle(
      ref,
      () => ({
        async flush() {
          await connection.current?.flush();
        },
        async prepareToLeave() {
          await connection.current?.prepareToLeave();
        },
        async resume() {
          await connection.current?.resume();
        },
        inspect: {
          async open() {
            await connection.current?.inspect.open();
          },
          async close() {
            await connection.current?.inspect.close();
          },
        },
        hasPendingChanges: () => connection.current?.hasPendingChanges() ?? false,
      }),
      [],
    );
    useEffect(() => {
      if (!container.current) return;
      callbacks.current.onError?.("");
      callbacks.current.onStatus?.([]);
      try {
        const current = connectHtmlView(container.current, {
          source: props.source,
          ...(callbacks.current.locale ? { locale: callbacks.current.locale } : {}),
          ...(props.allowedOrigins ? { allowedOrigins: props.allowedOrigins } : {}),
          loadEngine: props.loadEngine,
          onError: (message) => callbacks.current.onError?.(message),
          onStatus: (states) => callbacks.current.onStatus?.(states),
          onInspectChanged: (value) => callbacks.current.onInspectChanged?.(value),
        });
        connection.current = current;
        return () => {
          current.dispose();
          if (connection.current === current) connection.current = undefined;
        };
      } catch (error) {
        // A failed replacement must not leave the previous page's scripts running.
        container.current.replaceChildren();
        callbacks.current.onError?.(error instanceof Error ? error.message : String(error));
      }
    }, [props.source, props.allowedOrigins, props.loadEngine]);
    return (
      <div
        ref={container}
        role="region"
        aria-label={props.title}
        className={props.className}
        style={props.style}
      />
    );
  },
);
