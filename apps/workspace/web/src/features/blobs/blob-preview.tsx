import { Download, FileQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { buttonVariants } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";

interface BlobPreviewResource {
  readonly name: string;
  readonly originalFilename: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly contentUrl: string;
  readonly downloadUrl: string;
}

export function BlobPreview({ resource }: { readonly resource: BlobPreviewResource }) {
  const mediaType = resource.mediaType.toLowerCase();
  if (mediaType.startsWith("image/")) {
    return (
      <div className="grid h-full min-h-0 place-items-center overflow-auto bg-muted/25 p-8">
        <img
          className="max-h-full max-w-full rounded-md object-contain shadow-sm"
          src={resource.contentUrl}
          alt={resource.name}
        />
      </div>
    );
  }
  if (mediaType.startsWith("video/")) {
    return (
      <div className="grid h-full min-h-0 place-items-center bg-black p-6">
        <video
          className="max-h-full max-w-full"
          src={resource.contentUrl}
          controls
          preload="metadata"
        />
      </div>
    );
  }
  if (mediaType.startsWith("audio/")) {
    return (
      <div className="grid h-full min-h-0 place-items-center bg-muted/25 p-8">
        <audio className="w-full max-w-2xl" src={resource.contentUrl} controls preload="metadata" />
      </div>
    );
  }
  if (mediaType === "application/pdf") {
    return (
      <iframe
        className="h-full min-h-0 w-full border-0 bg-muted/25"
        src={resource.contentUrl}
        title={resource.name}
      />
    );
  }
  if (mediaType.startsWith("text/")) {
    return <TextPreview resource={resource} />;
  }
  return <UnsupportedPreview resource={resource} />;
}

function TextPreview({ resource }: { readonly resource: BlobPreviewResource }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  const previewBytes = 256 * 1024;
  useEffect(() => {
    setFailed(false);
    setText("");
    if (resource.byteSize === 0) {
      return;
    }
    const controller = new AbortController();
    void fetch(resource.contentUrl, {
      credentials: "include",
      headers: { Range: `bytes=0-${previewBytes - 1}` },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Preview failed with ${response.status}.`);
        return response.text();
      })
      .then(setText)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [resource.byteSize, resource.contentUrl]);
  if (failed) return <UnsupportedPreview resource={resource} />;
  return (
    <div className="h-full min-h-0 overflow-auto bg-muted/20 p-6">
      {resource.byteSize > previewBytes ? (
        <p className="mx-auto mb-3 max-w-5xl text-xs text-muted-foreground">
          {t("textPreviewTruncated")}
        </p>
      ) : null}
      <pre className="mx-auto min-h-full max-w-5xl whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-6 font-mono text-sm leading-6 text-foreground shadow-xs">
        {text}
      </pre>
    </div>
  );
}

function UnsupportedPreview({ resource }: { readonly resource: BlobPreviewResource }) {
  const { t } = useI18n();
  return (
    <div className="grid h-full min-h-0 place-items-center bg-muted/20 p-8 text-center">
      <div className="grid max-w-md justify-items-center gap-3">
        <span className="grid size-16 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <FileQuestion className="size-8" />
        </span>
        <div>
          <h2 className="m-0 text-base font-semibold text-foreground">
            {t("previewUnavailable")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("previewUnavailableDescription")}
          </p>
        </div>
        <a
          className={cn(buttonVariants({ variant: "primary", size: "md" }), "no-underline")}
          href={resource.downloadUrl}
        >
          <Download />
          {t("download")}
        </a>
      </div>
    </div>
  );
}
