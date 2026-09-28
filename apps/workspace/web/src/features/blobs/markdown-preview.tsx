import { useEffect, useState } from "react";
import { MarkdownViewer } from "@univerjs/univer-workspace-markdown-viewer";
import { readMarkdownContent } from "@univerjs/univer-workspace-markdown-viewer/content";
import { useI18n } from "../../shared/i18n";
import type { BlobPreviewResource } from "./blob-preview";

export function MarkdownPreview({ resource }: { readonly resource: BlobPreviewResource }) {
  const { language, t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setContent(null);
    setFailed(false);
    if (resource.byteSize === 0) {
      setContent("");
      return;
    }
    void fetch(resource.contentUrl, {
      credentials: "include",
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
  }, [resource.contentUrl, resource.byteSize]);
  if (failed)
    return (
      <div className="p-6">
        <p role="alert">{t("filePreviewFailed")}</p>
        <a className="underline" href={resource.downloadUrl}>
          {t("download")}
        </a>
      </div>
    );
  if (content === null)
    return (
      <p className="p-6 text-muted-foreground" role="status">
        {t("filePreviewLoading")}
      </p>
    );
  return <MarkdownViewer text={content} locale={language} />;
}
