import { useEffect, useRef, useState } from "react";
import { Button, CheckIcon, ConfirmDialog, EllipsisIcon, MenuContent, MenuItem, MenuRoot,
  MenuTrigger, SendIcon, TrashIcon } from "@univerjs/univer-workspace-ui";
import type { DocumentWorktreeState, WorktreeAction } from "../../../shared/state.ts";
import type { UniverLocaleKey } from "../../locales.ts";
import { postWorktreeAction } from "../../api/univer-api.ts";
import { actionDialogCopy } from "../turn-context-card-model.ts";
import css from "./WorktreeActions.module.scss";

/** Shared lifecycle controls adapt to the containing header, including Sidecar resizing. */
export function WorktreeActions(props: {
  worktree: DocumentWorktreeState;
  t: (key: UniverLocaleKey) => string;
  onActionSettled?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [pending, setPending] = useState<WorktreeAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { worktree, t } = props;
  useEffect(() => {
    const header = root.current?.closest("header");
    if (!header) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWide(entry.contentRect.width >= 600);
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const discard = worktree.capabilities.discard && (worktree.status === "draft" || worktree.status === "ready");
  const reopen = worktree.capabilities.reopen && worktree.status === "ready";
  const menuDiscard = discard && !wide;
  const dialog = pending === null ? null : actionDialogCopy(pending, t);
  const confirm = async () => {
    if (pending === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postWorktreeAction(worktree.worktreeId, pending);
      setPending(null);
      props.onActionSettled?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };
  return <div ref={root} className={css.actions} data-worktree-actions data-wide={wide}>
    {discard && wide ? <Button variant="destructive-ghost" size="sm" disabled={busy}
      onClick={() => setPending("discard")}><TrashIcon />{t("viewer.discard")}</Button> : null}
    {worktree.capabilities.markReady ? <Button size="sm" disabled={busy}
      onClick={() => setPending("ready")}><SendIcon />{t("viewer.submitForReview")}</Button> : null}
    {worktree.capabilities.merge && worktree.status === "ready" ? <Button variant="success" size="sm" disabled={busy}
      onClick={() => setPending("merge")}><CheckIcon />{t("viewer.mergeToCurrent")}</Button> : null}
    {reopen || menuDiscard ? <MenuRoot>
      <MenuTrigger render={<Button variant="ghost" size="icon-sm" />} disabled={busy} aria-label={t("worktree.moreActions")}>
        <EllipsisIcon />
      </MenuTrigger>
      <MenuContent align="end">
        {reopen ? <MenuItem onClick={() => setPending("reopen")}>{t("turn.reopen")}</MenuItem> : null}
        {menuDiscard ? <MenuItem className={css.destructive} onClick={() => setPending("discard")}>{t("viewer.discard")}</MenuItem> : null}
      </MenuContent>
    </MenuRoot> : null}
    {dialog ? <ConfirmDialog open onOpenChange={open => { if (!open && !busy) { setPending(null); setError(null); } }}
      title={dialog.title} description={dialog.description} confirmText={dialog.confirmText}
      cancelText={t("viewer.cancel")} danger={dialog.danger} disabled={busy} onConfirm={() => { void confirm(); }} /> : null}
    {error ? <span className={css.error} role="alert">{error}</span> : null}
  </div>;
}
