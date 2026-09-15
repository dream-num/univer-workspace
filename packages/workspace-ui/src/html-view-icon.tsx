import type { SVGProps } from "react";
import css from "./html-view-icon.module.scss";

export function HtmlViewIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      aria-hidden="true"
      className={[css.icon, className].filter(Boolean).join(" ")}
      {...props}
    >
      <rect x="2" y="3" width="20" height="18" rx="3" fill="currentColor" />
      <path d="M5.5 6.5h1m3 0h1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="5" y="10" width="4" height="8" rx="1" fill="#fff" fillOpacity=".55" />
      <rect x="11" y="10" width="8" height="8" rx="1" fill="#fff" />
    </svg>
  );
}
