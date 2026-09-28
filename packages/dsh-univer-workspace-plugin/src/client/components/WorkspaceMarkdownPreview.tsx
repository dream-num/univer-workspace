import { useEffect, useState } from "react";
import { MarkdownViewer } from "@univerjs/univer-workspace-markdown-viewer";
import {
  MARKDOWN_PREVIEW_BYTES,
  readMarkdownContent,
  type MarkdownContent,
} from "@univerjs/univer-workspace-markdown-viewer/content";
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
  const [content, setContent] = useState<MarkdownContent | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setContent(null);
    setFailed(false);
    if (props.byteSize === 0) {
      setContent({ text: "", truncated: false });
      return;
    }
    void fetch(props.contentUrl, {
      credentials: "same-origin",
      signal: controller.signal,
      headers: { Range: `bytes=0-${MARKDOWN_PREVIEW_BYTES}` },
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
  if (!content)
    return (
      <p className={css.status} role="status">
        {props.t("blob.loading")}
      </p>
    );
  return <MarkdownViewer {...content} locale={props.locale} />;
}
