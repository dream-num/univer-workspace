import { FileTextIcon, UserIcon } from "@univerjs/univer-workspace-ui";
import type { DocumentWorktreeState } from "../../../shared/state.ts";
import { formatOptionalDateTime } from "../turn-context-card-model.ts";
import css from "./WorktreeMetadata.module.scss";

/** The same labeled metadata in conversation summaries and Sidecar details. */
export function WorktreeMetadata(props: {
  worktree: DocumentWorktreeState;
  spaceNames: readonly string[];
  emptyDescription: string;
}) {
  const updatedAt = formatOptionalDateTime(props.worktree.updatedAt);
  return <div className={css.metadata}>
    <div className={css.facts}>
      {props.spaceNames.map(name => <span className={css.fact} key={name} title={`Space: ${name}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z M3 12l9 5 9-5 M3 16l9 5 9-5" /></svg>
        <span>{name}</span>
      </span>)}
      <span className={css.fact}><UserIcon aria-hidden="true" /><span>{props.worktree.creator.displayName}</span></span>
      {updatedAt ? <span className={css.fact}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        <time dateTime={props.worktree.updatedAt}>{updatedAt}</time>
      </span> : null}
    </div>
    <p className={css.fact}><FileTextIcon aria-hidden="true" /><span>{props.worktree.summary?.trim() || props.emptyDescription}</span></p>
  </div>;
}
