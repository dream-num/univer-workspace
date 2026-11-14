import { useI18n } from "../../shared/i18n";
import type { HtmlViewStyles } from "./style-result";
import "./style-gallery.css";

const thumbnails = import.meta.glob<string>("./style-thumbnails/*.webp", { eager: true, query: "?url", import: "default" });
const messages = {
  "en-US": { locale: "en", label: "Page styles", default: "Default", use: (name: string) => `Use ${name}` },
  "zh-CN": { locale: "zh", label: "页面风格", default: "默认", use: (name: string) => `用「${name}」` },
} as const;

export function HtmlViewStyleGallery({ catalog, onFill, disabled }: {
  readonly catalog: HtmlViewStyles; readonly onFill: ((text: string) => void) | undefined; readonly disabled: boolean;
}) {
  const m = messages[useI18n().language];
  return <section className="html-style-gallery" aria-label={m.label}>
    {catalog.styles.map((style) => {
      const thumbnail = thumbnails[`./style-thumbnails/${style.id}.webp`];
      const name = style.name[m.locale];
      return <button type="button" className="html-style-card" key={style.id} disabled={disabled || !onFill}
        onClick={() => onFill?.(m.use(name))}>
        {thumbnail ? <img src={thumbnail} alt={name} loading="lazy" /> : null}
        <span className="html-style-heading"><strong>{name}</strong>{style.id === catalog.default ? <span className="html-style-default">{m.default}</span> : null}</span>
        <span className="html-style-mood">{style.mood[m.locale]}</span>
      </button>;
    })}
  </section>;
}
