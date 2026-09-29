import { useId, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownUrl } from "./content.js";
import { markdownHeadings } from "./headings.js";
import css from "./markdown-viewer.module.scss";

const messages = {
  "zh-CN": {
    preview: "预览",
    source: "源码",
    empty: "文件为空",
    unresolved: "暂不支持此链接或相对路径",
    image: "加载外部图片",
    imageFailed: "图片加载失败",
  },
  "en-US": {
    preview: "Preview",
    source: "Source",
    empty: "This file is empty",
    unresolved: "Unsupported link or relative path",
    image: "Load external image",
    imageFailed: "Image failed to load",
  },
};

function ExternalImage({
  src,
  alt,
  labels,
}: {
  src: string;
  alt: string;
  labels: (typeof messages)["en-US"];
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!src) return <span title={labels.unresolved}>{alt || labels.unresolved}</span>;
  if (failed)
    return (
      <span role="status">
        {labels.imageFailed}: {alt}
      </span>
    );
  if (!loaded)
    return (
      <button type="button" title={src} onClick={() => setLoaded(true)}>
        {labels.image}
        {alt ? `: ${alt}` : ""}
      </button>
    );
  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function MarkdownViewer({
  text,
  locale = "en-US",
  chrome = "full",
}: {
  readonly text: string;
  readonly locale?: "zh-CN" | "en-US";
  /**
   * `full` is the file viewer with its Preview/Source toolbar and own scroll area.
   * `none` renders only the content so a host can embed it, e.g. in a comment.
   */
  readonly chrome?: "full" | "none";
}) {
  const labels = messages[locale];
  const [source, setSource] = useState(false);
  const prefix = `markdown-${useId().replace(/:/g, "")}-`;
  const root = useRef<HTMLDivElement>(null);
  const rendered = useMemo(
    () => (
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[markdownHeadings, { prefix }]]}
        remarkRehypeOptions={{
          clobberPrefix: prefix,
          footnoteLabel: locale === "zh-CN" ? "脚注" : "Footnotes",
          footnoteBackLabel: locale === "zh-CN" ? "返回引用" : "Back to reference",
        }}
        urlTransform={(url, key) => markdownUrl(url, key === "src")}
        components={{
          a: ({
            href,
            children,
            id,
            "aria-label": ariaLabel,
            "aria-describedby": ariaDescribedBy,
          }) => {
            if (!href) return <span title={labels.unresolved}>{children}</span>;
            if (href.startsWith("#")) {
              let fragment: string;
              try {
                fragment = decodeURIComponent(href.slice(1));
              } catch {
                return <span>{children}</span>;
              }
              const anchorId = id;
              const targetId = fragment.startsWith(prefix)
                ? fragment
                : `${prefix}heading-${fragment}`;
              return (
                <a
                  id={anchorId}
                  aria-label={ariaLabel}
                  aria-describedby={ariaDescribedBy}
                  href={`#${targetId}`}
                  onClick={(event) => {
                    event.preventDefault();
                    const target = root.current?.ownerDocument.getElementById(targetId);
                    if (target && root.current?.contains(target)) {
                      target.scrollIntoView({ block: "start" });
                      target.setAttribute("tabindex", "-1");
                      target.focus({ preventScroll: true });
                    }
                  }}
                >
                  {children}
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => (
            <ExternalImage key={src} src={src ?? ""} alt={alt ?? ""} labels={labels} />
          ),
          table: ({ children }) => (
            <div className={css.table}>
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    ),
    [text, locale, prefix, labels],
  );
  if (chrome === "none") {
    return (
      <div className={`${css.viewer} ${css.embedded}`} ref={root}>
        <article className={css.prose}>{rendered}</article>
      </div>
    );
  }
  return (
    <div className={css.viewer} ref={root}>
      <div className={css.toolbar} role="group" aria-label="Markdown">
        <button
          type="button"
          aria-pressed={!source}
          onClick={() => setSource(false)}
        >
          {labels.preview}
        </button>
        <button type="button" aria-pressed={source} onClick={() => setSource(true)}>
          {labels.source}
        </button>
      </div>
      <div className={css.scroll}>
        {!text ? (
          <p className={css.notice} role="status">
            {labels.empty}
          </p>
        ) : source ? (
          <pre className={css.source}>{text}</pre>
        ) : (
          <article className={css.prose}>{rendered}</article>
        )}
      </div>
    </div>
  );
}
