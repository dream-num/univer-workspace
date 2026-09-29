import {
  Bot,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { Button, buttonVariants } from "../../shared/ui/button";
import { toast } from "../../shared/ui/toaster";
import { cn } from "../../shared/utils/cn";

const AGENT_DOWNLOAD_URL = "https://github.com/dream-num/univer-workspace/releases/latest";
const CLI_GUIDE_URL =
  "https://github.com/dream-num/univer-workspace/blob/main/apps/cli/README.md#install";
const INSTALL_COMMANDS = [
  "npm install --global univer-workspace-cli@latest",
  "npx skills add dream-num/univer-workspace --skill univer-workspace-cli -g",
].join("\n");

export function WorktreeOnboarding({
  origin,
  compact = false,
}: {
  readonly origin: string;
  readonly compact?: boolean;
}) {
  const { t } = useI18n();

  if (compact) {
    return (
      <aside className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-brand-25 px-6 py-3 text-xs max-[720px]:px-4.5">
        <span className="text-muted-foreground">{t("onboardingTeamHint")}</span>
        <a
          className="text-primary hover:underline"
          href={AGENT_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("onboardingDownload")} <ExternalLink aria-hidden="true" className="inline size-3" />
        </a>
        <a
          className="text-primary hover:underline"
          href={CLI_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("onboardingCliLink")} <ExternalLink aria-hidden="true" className="inline size-3" />
        </a>
      </aside>
    );
  }

  return (
    <section
      aria-labelledby="worktree-onboarding-title"
      className="h-full overflow-y-auto bg-background"
    >
      <div className="mx-auto max-w-5xl px-6 py-10 max-[720px]:px-4.5 max-[720px]:py-7">
        <header className="text-center">
          <p className="flex items-center justify-center gap-2 text-xs font-medium text-primary">
            <Sparkles aria-hidden="true" className="size-4" />
            {t("onboardingEyebrow")}
          </p>
          <h2
            id="worktree-onboarding-title"
            className="mx-auto mt-3 max-w-3xl text-2xl leading-relaxed font-semibold text-foreground max-[720px]:text-xl"
          >
            {t("onboardingTitle")}
          </h2>
        </header>

        <div className="mt-7 grid gap-5 min-[900px]:grid-cols-2">
          <article className="flex min-w-0 flex-col rounded-2xl border border-brand-200 bg-linear-to-br from-brand-25 to-background p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-primary">
                <Bot aria-hidden="true" className="size-6" />
              </span>
              <span className="rounded bg-brand-100 px-2 py-1 text-xs text-brand-700">
                {t("onboardingDesktop")}
              </span>
            </div>
            <h3 className="text-xl font-semibold text-foreground">Workspace Agent</h3>
            <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
              {t("onboardingAgentDescription")}
            </p>
            <div className="my-5 rounded-xl border border-border bg-background p-4">
              <p className="text-xs text-muted-foreground">{t("onboardingExample")}</p>
              <span className="mt-3 inline-block rounded bg-brand-50 px-2 py-1 text-xs text-brand-700">
                @ {t("onboardingExampleFile")}
              </span>
              <p className="mt-2 text-[13px] text-secondary-foreground">
                {t("onboardingExamplePrompt")}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
                <FileSpreadsheet aria-hidden="true" className="size-4 text-success" />
                <span className="text-secondary-foreground">{t("onboardingExampleResult")}</span>
                <span className="ml-auto rounded bg-success-soft px-2 py-1 text-success-soft-foreground">
                  {t("onboardingExampleReady")}
                </span>
              </div>
            </div>
            <div className="mt-auto grid gap-3 text-center">
              <a
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-auto min-h-11 whitespace-normal text-sm",
                )}
                href={AGENT_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download aria-hidden="true" />
                {t("onboardingDownload")}
                <ExternalLink aria-hidden="true" />
              </a>
              <p className="text-xs text-muted-foreground">
                Windows · macOS · Linux · GitHub Releases
              </p>
            </div>
          </article>

          <article className="flex min-w-0 flex-col rounded-2xl border border-border bg-background p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-muted text-secondary-foreground">
                <Terminal aria-hidden="true" className="size-6" />
              </span>
              <span className="text-xs text-muted-foreground">{t("onboardingExistingAgent")}</span>
            </div>
            <h3 className="text-xl font-semibold text-foreground">Workspace CLI</h3>
            <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
              {t("onboardingCliDescription")}
            </p>
            <div className="my-5 rounded-xl border border-border bg-surface p-4">
              <p className="mb-3 text-xs text-muted-foreground">{t("onboardingInstall")}</p>
              <pre className="text-xs leading-6 whitespace-pre-wrap text-secondary-foreground">
                <code className="[overflow-wrap:anywhere]">{INSTALL_COMMANDS}</code>
              </pre>
            </div>
            <div className="mt-auto grid gap-3 text-center">
              <OnboardingCopyButton value={INSTALL_COMMANDS} label={t("onboardingCopyInstall")} />
              <p className="text-xs text-muted-foreground">
                {t("onboardingNodeRequired")} ·{" "}
                <a
                  className="underline underline-offset-4"
                  href={CLI_GUIDE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("onboardingInstallGuide")} ↗
                </a>
              </p>
            </div>
          </article>
        </div>

        <ol className="my-7 grid gap-5 min-[720px]:grid-cols-3">
          {(
            [
              ["onboardingConnect", "onboardingConnectDescription"],
              ["onboardingTask", "onboardingTaskDescription"],
              ["onboardingReview", "onboardingReviewDescription"],
            ] as const
          ).map(([title, description], index) => (
            <li key={title} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-xs text-muted-foreground">
                {index + 1}
              </span>
              <div>
                <p className="text-xs font-medium text-foreground">{t(title)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t(description)}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t border-border pt-5 text-xs">
          <span className="text-muted-foreground">{t("onboardingOrigin")}</span>
          <code className="break-all text-secondary-foreground">{origin}</code>
          <OnboardingCopyButton value={origin} label={t("onboardingCopyOrigin")} compact />
        </div>
      </div>
    </section>
  );
}

function OnboardingCopyButton({
  value,
  label,
  compact = false,
}: {
  readonly value: string;
  readonly label: string;
  readonly compact?: boolean;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      clearTimeout(timer.current);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      clearTimeout(timer.current);
      setCopied(false);
      toast.error(t("onboardingCopyFailed"));
    }
  };

  return (
    <Button
      variant={compact ? "link" : "secondary"}
      size={compact ? "sm" : "lg"}
      className={cn(
        compact ? "min-w-28" : "h-auto min-h-11 whitespace-normal text-sm",
        copied && "text-success",
      )}
      onClick={() => void copy()}
      aria-live="polite"
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? t("onboardingCopied") : label}
    </Button>
  );
}
