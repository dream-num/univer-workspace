import type { ReactElement } from "react";
import css from "./WorktreeBranchIcon.module.scss";

/** Lifecycle glyph shared by Agent navigation and review surfaces. */
export function WorktreeBranchIcon(props: { readonly status: string; readonly className?: string }): ReactElement {
  const merged = props.status === "merged";
  const closed = props.status === "discarded";
  const draft = props.status === "draft";
  return (
    <svg className={`${css.icon} ${props.className ?? ""}`} data-status={props.status} viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <circle cx="4" cy="3" r="1.5" />
      <circle cx="4" cy="13" r="1.5" />
      <path d="M4 4.5v7" />
      <circle cx="12" cy="13" r="1.5" />
      {merged ? (
        <path d="M5.5 4.5 12 11.5" />
      ) : closed ? (
        <><path d="m10 2 4 4m0-4-4 4" /><path d="M12 8v3.5" /></>
      ) : draft ? (
        <><circle cx="12" cy="3" r="1.5" /><path d="M12 6v3" strokeDasharray="1 2" /></>
      ) : (
        <><path d="m9.5 4 2.5-2 2.5 2" /><path d="M12 2v9.5" /></>
      )}
    </svg>
  );
}
