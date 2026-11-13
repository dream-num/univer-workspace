import { Bot, Copy, Download, ExternalLink, Plug, Terminal } from "lucide-react";
import { useId, useState } from "react";
import { AccessTokensDialog } from "../../../features/account";
import { AGENT_DOWNLOAD_URL, CLI_GUIDE_URL } from "../../../features/worktrees/worktree-onboarding";
import { useI18n } from "../../../shared/i18n";
import { toast } from "../../../shared/ui";

const CLI_INSTALL = "npm install --global univer-workspace-cli@latest";

export function HomeTools() {
  const { t } = useI18n();
  const [tokens, setTokens] = useState(false);
  const [tab, setTab] = useState(0);
  const id = useId();
  const url = `${window.location.origin}/mcp`;
  const tabs = [
    { label: "URL", command: url },
    { label: "Claude Code", command: `claude mcp add --transport http univer-workspace ${url}` },
    { label: "Codex", command: `codex mcp add univer-workspace --url ${url}` },
  ];
  return <section className="rd-home-tools" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>{t("repositoryHomeTools")}</h2>
    <div className="rd-tool">
      <h3><span className="rd-repo-ic"><Bot aria-hidden="true" /></span>Workspace Agent</h3>
      <p>{t("repositoryHomeAgentDescription")}</p>
      <a className="repository-secondary-link" href={AGENT_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer"><Download aria-hidden="true" />{t("onboardingDownload")}</a>
    </div>
    <div className="rd-tool">
      <h3><span className="rd-repo-ic"><Terminal aria-hidden="true" /></span>Workspace CLI</h3>
      <p>{t("repositoryHomeCliDescription")}</p>
      <CopyCode value={CLI_INSTALL} />
      <a className="rd-tool-link" href={CLI_GUIDE_URL} target="_blank" rel="noopener noreferrer">{t("onboardingCliLink")}<ExternalLink aria-hidden="true" /></a>
    </div>
    <div className="rd-tool">
      <h3><span className="rd-repo-ic"><Plug aria-hidden="true" /></span>{t("repositoryHomeMcp")}</h3>
      <p>{t("repositoryHomeMcpDescription")}</p>
      <div className="rd-mcp-tabs" role="tablist" aria-label={t("repositoryHomeMcp")}>
        {tabs.map((item, index) => <button key={item.label} type="button" role="tab" id={`${id}-tab-${index}`} aria-controls={`${id}-panel`} aria-selected={tab === index} tabIndex={tab === index ? 0 : -1}
          onClick={() => setTab(index)} onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
              : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
              : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
            if (next === null) return;
            event.preventDefault();
            setTab(next);
            document.getElementById(`${id}-tab-${next}`)?.focus();
          }}>{item.label}</button>)}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`} tabIndex={0}><CopyCode value={tabs[tab]?.command ?? url} /></div>
      <div className="rd-tool-links">
        <a className="rd-tool-link" href="https://github.com/dream-num/univer-workspace#connect-an-ai-assistant-mcp" target="_blank" rel="noopener noreferrer">{t("repositoryHomeSetupGuide")}<ExternalLink aria-hidden="true" /></a>
        <button className="rd-tool-link" type="button" onClick={() => setTokens(true)}>{t("accessTokens")}</button>
      </div>
    </div>
    <AccessTokensDialog open={tokens} onOpenChange={setTokens} />
  </section>;
}

function CopyCode({ value }: { readonly value: string }) {
  const { t } = useI18n();
  return <div className="rd-tool-code"><code>{value}</code><button className="rd-iconbtn" type="button" aria-label={t("repositoryHomeCopyCode")} onClick={async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("repositoryHomeCodeCopied"));
    } catch {
      toast.error(t("onboardingCopyFailed"));
    }
  }}><Copy aria-hidden="true" /></button></div>;
}
