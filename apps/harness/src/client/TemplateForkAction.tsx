import { useEffect, useState } from "react";
import type { PropsLocale, PropsRuntime, InjectFace } from "@deepseek-ai/dsh-client-ui-slots";
import type { UwhMeView, UwhTemplate } from "../contract.ts";
import type { HarnessLocaleKey } from "./locales.ts";

export interface TemplateForkInjected {
  readonly loadMe: () => Promise<UwhMeView>;
  readonly forkTemplate: (template: UwhTemplate) => Promise<string>;
  readonly openSession: (sessionId: string) => void;
}

type TemplateForkProps = PropsRuntime<"sidebar.footer.action">
  & PropsLocale<"univer-workspace-harness">
  & InjectFace<TemplateForkInjected>;

/** Footer action that restores the configured template-fork entry. */
export function TemplateForkAction({ wide, loadMe, forkTemplate, openSession, t }: TemplateForkProps) {
  const [templates, setTemplates] = useState<readonly UwhTemplate[]>([]);
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

  const choose = (template: UwhTemplate): void => {
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
        aria-label={t("templateFork" as HarnessLocaleKey)}
        aria-expanded={expanded}
        disabled={busy}
        onClick={() => setExpanded(value => !value)}
      >
        <span aria-hidden="true">✦</span>
        {wide && <span>{t("templateFork" as HarnessLocaleKey)}</span>}
      </button>
      {expanded && (
        <div className="uwh-templateMenu" role="menu">
          <div className="uwh-templateMenuTitle">{t("templates" as HarnessLocaleKey)}</div>
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
      {error && <span className="uwh-templateError" role="alert">{t("templateForkFailed" as HarnessLocaleKey)}</span>}
    </div>
  );
}
