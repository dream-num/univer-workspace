import { useEffect, useState } from "react";
import { MarkdownViewer } from "@univerjs/univer-workspace-markdown-viewer";
import { readMarkdownContent } from "@univerjs/univer-workspace-markdown-viewer/content";
import type { ViewerLocale } from "../viewer-locale.ts";
import type { UniverLocaleKey } from "../locales.ts";
import css from "./WorkspaceBlobViewer.module.scss";

export function WorkspaceMarkdownPreview(props: {
  readonly contentUrl: string;
  readonly downloadUrl: string;
  readonly byteSize: number;
  readonly locale: ViewerLocale;
  readonly t: (key: UniverLocaleKey) => string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setContent(null);
    setFailed(false);
    if (props.byteSize === 0) {
      setContent("");
      return;
    }
    void fetch(props.contentUrl, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(readMarkdownContent)
      .then((value) => {
        if (!controller.signal.aborted) setContent(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [props.contentUrl, props.byteSize]);
  if (failed)
    return (
      <div className={css.unsupported}>
        <p role="alert">{props.t("blob.markdownFailed")}</p>
        <a className={css.primaryAction} href={props.downloadUrl}>
          {props.t("blob.download")}
        </a>
      </div>
    );
  if (content === null)
    return (
      <p className={css.status} role="status">
        {props.t("blob.loading")}
      </p>
    );
  return <MarkdownViewer text={content} locale={props.locale} />;
}
