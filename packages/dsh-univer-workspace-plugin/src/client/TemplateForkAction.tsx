import { useEffect, useState } from "react";
import type { PropsLocale, PropsRuntime, InjectFace } from "@deepseek-ai/dsh-client-ui-slots";
import type { WorkspaceMeView, WorkspaceTemplate } from "./workspace-contract.ts";

export interface TemplateForkInjected {
  readonly loadMe: () => Promise<WorkspaceMeView>;
  readonly forkTemplate: (template: WorkspaceTemplate) => Promise<string>;
  readonly openSession: (sessionId: string) => void;
}

type TemplateForkProps = PropsRuntime<"sidebar.footer.action">
  & PropsLocale<"univer">
  & InjectFace<TemplateForkInjected>;

/** Footer action that restores the configured template-fork entry. */
export function TemplateForkAction({ wide, loadMe, forkTemplate, openSession, t }: TemplateForkProps) {
  const [templates, setTemplates] = useState<readonly WorkspaceTemplate[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    void loadMe().then((view) => {
      if (live) setTemplates(view.templates);
    }).catch(() => {
      if (live) setError(true);
    });
    return () => { live = false; };
  }, [loadMe]);

  if (templates.length === 0) return null;

  const choose = (template: WorkspaceTemplate): void => {
    if (busy) return;
    setBusy(true);
    setError(false);
    void forkTemplate(template).then(openSession).catch(() => {
      setError(true);
    }).finally(() => {
      setBusy(false);
      setExpanded(false);
    });
  };

  return (
    <div className="uwh-templateAction">
      <button
        type="button"
        className={`uwh-templateTrigger${wide ? "" : " uwh-templateTriggerRail"}`}
        aria-label={t("workspace.templateFork")}
        aria-expanded={expanded}
        disabled={busy}
        onClick={() => setExpanded(value => !value)}
      >
        <span aria-hidden="true">✦</span>
        {wide && <span>{t("workspace.templateFork")}</span>}
      </button>
      {expanded && (
        <div className="uwh-templateMenu" role="menu">
          <div className="uwh-templateMenuTitle">{t("workspace.templates")}</div>
          {templates.map(template => (
            <button
              key={template.key}
              type="button"
              role="menuitem"
              className="uwh-templateItem"
              disabled={busy}
              onClick={() => choose(template)}
            >
              <span className="uwh-templateItemName">{template.label || template.key}</span>
              {template.description && <span className="uwh-templateItemDescription">{template.description}</span>}
            </button>
          ))}
        </div>
      )}
      {error && <span className="uwh-templateError" role="alert">{t("workspace.templateForkFailed")}</span>}
    </div>
  );
}
