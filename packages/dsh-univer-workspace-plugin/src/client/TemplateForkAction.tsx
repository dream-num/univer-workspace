import { useEffect, useState } from "react";
import { Button, PlusIcon } from "@univerjs/univer-workspace-ui";
import type { PropsLocale, PropsRuntime, InjectFace } from "@deepseek-ai/dsh-client-ui-slots";
import type { WorkspaceMeView, WorkspaceTemplate } from "./workspace-contract.ts";
import css from "./TemplateForkAction.module.scss";

export interface TemplateForkInjected {
  readonly loadMe: () => Promise<WorkspaceMeView>;
  readonly forkTemplate: (template: WorkspaceTemplate) => Promise<string>;
  readonly openSession: (sessionId: string) => void;
}

type TemplateForkProps = PropsRuntime<"sidebar.footer.action"> &
  PropsLocale<"univer"> &
  InjectFace<TemplateForkInjected>;

/** Footer action that restores the configured template-fork entry. */
export function TemplateForkAction({
  wide,
  loadMe,
  forkTemplate,
  openSession,
  t,
}: TemplateForkProps) {
  const [templates, setTemplates] = useState<readonly WorkspaceTemplate[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    void loadMe()
      .then((view) => {
        if (live) setTemplates(view.templates);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [loadMe]);

  if (templates.length === 0) return null;

  const choose = (template: WorkspaceTemplate): void => {
    if (busy) return;
    setBusy(true);
    setError(false);
    void forkTemplate(template)
      .then(openSession)
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setBusy(false);
        setExpanded(false);
      });
  };

  return (
    <div className={css.action}>
      <Button
        variant="secondary"
        size="sm"
        className={wide ? css.trigger : `${css.trigger} ${css.rail}`}
        aria-label={t("workspace.templateFork")}
        aria-expanded={expanded}
        disabled={busy}
        onClick={() => setExpanded((value) => !value)}
      >
        <PlusIcon aria-hidden="true" />
        {wide && <span>{t("workspace.templateFork")}</span>}
      </Button>
      {expanded && (
        <div className={css.menu} role="menu">
          <div className={css.menuTitle}>{t("workspace.templates")}</div>
          {templates.map((template) => (
            <button
              key={template.key}
              type="button"
              role="menuitem"
              className={css.item}
              disabled={busy}
              onClick={() => choose(template)}
            >
              <span className={css.itemName}>{template.label || template.key}</span>
              {template.description && (
                <span className={css.itemDescription}>{template.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {error && (
        <span className={css.error} role="alert">
          {t("workspace.templateForkFailed")}
        </span>
      )}
    </div>
  );
}
