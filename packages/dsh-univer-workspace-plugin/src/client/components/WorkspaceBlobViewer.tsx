/**
 * Read-only middle surface for a Workspace Blob Resource. Blob content is not
 * a Univer Unit, so it deliberately does not mount the Univer collaboration
 * runtime; it uses the Workspace content/download proxy and the same three
 * column shell as a Resource Viewer.
 */
import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { CloseIcon, ExternalLinkIcon, FileIcon, FileTextIcon } from "@univerjs/univer-workspace-ui";
import type { WorkspaceBlobSurface } from "../navigation/workspace-navigation.ts";
import type { UniverLocaleKey } from "../locales.ts";
import css from "./WorkspaceBlobViewer.module.scss";

interface BlobResource {
  readonly id: string;
  readonly name: string;
  readonly originalFilename: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly contentUrl: string;
  readonly downloadUrl: string;
}

type BlobState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly resource: BlobResource }
  | { readonly status: "error"; readonly message: string };

export interface WorkspaceBlobViewerProps {
  readonly target: WorkspaceBlobSurface;
  readonly surfaceLeft: number | null;
  readonly surfaceWidth: number;
  readonly onClose: () => void;
  readonly t: (key: UniverLocaleKey) => string;
}

export function WorkspaceBlobViewer(props: WorkspaceBlobViewerProps): ReactElement {
  const [state, setState] = useState<BlobState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetch(
      `/univer-workspace/api/resources/${encodeURIComponent(props.target.resourceId)}/open`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const body = (await response.json().catch(() => undefined)) as unknown;
        if (!response.ok) {
          const message =
            body !== null && typeof body === "object" && "error" in body
              ? String((body as { error: unknown }).error)
              : `Blob open failed (${response.status})`;
          throw new Error(message);
        }
        return narrowBlobResource(body, props.target.resourceId, props.target.name);
      })
      .then((resource) => setState({ status: "ready", resource }))
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: reason instanceof Error ? reason.message : String(reason),
        });
      });
    return () => controller.abort();
  }, [props.target.name, props.target.resourceId]);

  const surfaceStyle = {
    "--uwh-resource-surface-left":
      props.surfaceLeft === null ? undefined : `${props.surfaceLeft}px`,
    "--uwh-resource-surface-width": `${props.surfaceWidth}px`,
  } as CSSProperties & {
    "--uwh-resource-surface-left": string | undefined;
    "--uwh-resource-surface-width": string;
  };

  return (
    <section className={css.surface} style={surfaceStyle} aria-label={props.target.name}>
      <header className={css.header}>
        <div className={css.identity}>
          <span className={css.glyph} aria-hidden="true">
            <FileIcon />
          </span>
          <div className={css.titleBlock}>
            <strong className={css.name}>{props.target.name}</strong>
            <span className={css.kind}>{props.t("blob.kind")}</span>
          </div>
        </div>
        {state.status === "ready" ? (
          <a className={css.download} href={proxyAssetUrl(state.resource.downloadUrl)}>
            <ExternalLinkIcon />
            {props.t("blob.download")}
          </a>
        ) : null}
        <button
          type="button"
          className={css.close}
          aria-label={props.t("dock.close")}
          onClick={props.onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className={css.content}>
        {state.status === "loading" ? (
          <div className={css.status} role="status">
            {props.t("blob.loading")}
          </div>
        ) : state.status === "error" ? (
          <div className={css.statusError} role="alert">
            {`${props.t("blob.loadFailed")}: ${state.message}`}
          </div>
        ) : (
          <BlobPreview resource={state.resource} t={props.t} />
        )}
      </div>
    </section>
  );
}

function BlobPreview(props: {
  readonly resource: BlobResource;
  readonly t: (key: UniverLocaleKey) => string;
}): ReactElement {
  const resource = props.resource;
  const mediaType = resource.mediaType.toLowerCase();
  const contentUrl = proxyAssetUrl(resource.contentUrl);
  if (mediaType.startsWith("image/")) {
    return (
      <div className={css.mediaStage}>
        <img className={css.image} src={contentUrl} alt={resource.name} />
      </div>
    );
  }
  if (mediaType.startsWith("video/")) {
    return (
      <div className={css.videoStage}>
        <video className={css.video} src={contentUrl} controls preload="metadata" />
      </div>
    );
  }
  if (mediaType.startsWith("audio/")) {
    return (
      <div className={css.mediaStage}>
        <audio className={css.audio} src={contentUrl} controls preload="metadata" />
      </div>
    );
  }
  if (mediaType === "application/pdf") {
    return <iframe className={css.pdf} src={contentUrl} title={resource.name} />;
  }
  if (mediaType.startsWith("text/")) {
    return <TextPreview resource={resource} t={props.t} />;
  }
  return (
    <div className={css.unsupported}>
      <FileTextIcon aria-hidden="true" />
      <strong>{props.t("blob.previewUnavailable")}</strong>
      <span>{props.t("blob.previewUnavailableDescription")}</span>
      <a className={css.primaryAction} href={proxyAssetUrl(resource.downloadUrl)}>
        <ExternalLinkIcon />
        {props.t("blob.download")}
      </a>
    </div>
  );
}

function TextPreview(props: {
  readonly resource: BlobResource;
  readonly t: (key: UniverLocaleKey) => string;
}): ReactElement {
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setText("");
    setFailed(false);
    void fetch(proxyAssetUrl(props.resource.contentUrl), {
      credentials: "same-origin",
      headers: { Range: "bytes=0-262143" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Text preview failed (${response.status})`);
        return response.text();
      })
      .then(setText)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [props.resource.contentUrl]);
  if (failed) {
    return (
      <div className={css.unsupported}>
        <strong>{props.t("blob.previewUnavailable")}</strong>
        <a className={css.primaryAction} href={proxyAssetUrl(props.resource.downloadUrl)}>
          {props.t("blob.download")}
        </a>
      </div>
    );
  }
  return (
    <div className={css.textStage}>
      {props.resource.byteSize > 262144 ? (
        <p className={css.truncated}>{props.t("blob.textTruncated")}</p>
      ) : null}
      <pre className={css.textPreview}>{text}</pre>
    </div>
  );
}

function proxyAssetUrl(value: string): string {
  if (value.startsWith("/api/")) return `/univer-workspace${value}`;
  return value;
}

function narrowBlobResource(raw: unknown, resourceId: string, fallbackName: string): BlobResource {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Blob open returned malformed data");
  }
  const resource = (raw as { resource?: unknown }).resource;
  if (resource === null || typeof resource !== "object" || Array.isArray(resource)) {
    throw new Error("Blob open returned malformed data");
  }
  const value = resource as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id : undefined;
  const name = typeof value.name === "string" ? value.name : fallbackName;
  const originalFilename =
    typeof value.originalFilename === "string" ? value.originalFilename : name;
  const mediaType = typeof value.mediaType === "string" ? value.mediaType : undefined;
  const byteSize = typeof value.byteSize === "number" ? value.byteSize : undefined;
  const contentUrl = typeof value.contentUrl === "string" ? value.contentUrl : undefined;
  const downloadUrl = typeof value.downloadUrl === "string" ? value.downloadUrl : undefined;
  if (
    id !== resourceId ||
    value.kind !== "blob" ||
    mediaType === undefined ||
    byteSize === undefined ||
    contentUrl === undefined ||
    downloadUrl === undefined
  ) {
    throw new Error("Blob open returned malformed data");
  }
  return { id, name, originalFilename, mediaType, byteSize, contentUrl, downloadUrl };
}
