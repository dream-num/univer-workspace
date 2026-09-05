import type { ReactElement } from "react";
import css from "./WorktreeBranchIcon.module.scss";

/** Same Worktree identity glyph in navigation and review headers. */
export function WorktreeBranchIcon(props: { readonly status: string }): ReactElement {
  return (
    <svg className={css.icon} data-status={props.status} viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <circle cx="4" cy="3" r="1.5" />
      <circle cx="4" cy="13" r="1.5" />
      <circle cx="12" cy="5" r="1.5" />
      <path d="M4 4.5v7M5.5 3.5c3.8 0 6.5 0 6.5 1.5" />
    </svg>
  );
}
