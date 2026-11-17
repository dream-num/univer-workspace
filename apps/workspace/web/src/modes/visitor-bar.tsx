import { Link, useLocation } from "@tanstack/react-router";
import { UniverCliIcon } from "@univerjs/icons";
import { ChevronDown, ChevronUp, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { components } from "../../../generated/http/schema.js";
import { ReportNodeButton } from "../features/nodes/report-node-button";
import { useI18n } from "../shared/i18n";
import { Badge, Button, buttonVariants } from "../shared/ui";
import { cn } from "../shared/utils/cn";

const STORAGE_KEY = "univer-workspace-visitor-bar-collapsed";
const BRAND_URL = "https://github.com/dream-num/univer-workspace";
const HOSTED_URL = "https://space.univer.ai";
const externalLinkClass = "inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline [&_svg]:size-3";

type NodeOwner = components["schemas"]["NodeOwner"];

export function VisitorBar({
  offerSignUp,
  nodeId,
  owner,
}: {
  readonly offerSignUp: boolean;
  readonly nodeId: string | undefined;
  readonly owner: NodeOwner | null | undefined;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const [collapsedPreference, setCollapsedPreference] = useState(() => {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const collapsed = offerSignUp && collapsedPreference;
  const author = owner ? t("sharePageAuthor", { name: owner.displayName }) : "";
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsedPreference(next);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // The control still works when tab storage is unavailable.
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <aside
      aria-label={t("madeWithWorkspace")}
      className={cn(
        "shrink-0 border-b border-border bg-background px-3 py-1.5",
        collapsed ? "flex justify-end" : "grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-1 sm:flex sm:flex-wrap",
      )}
    >
      {!collapsed ? (
        <>
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:flex-1">
            <UniverCliIcon aria-hidden="true" className="size-5 shrink-0 text-foreground" />
            {owner ? (
              <>
                <span className="min-w-0 truncate font-medium text-foreground" title={author}>
                  {author}
                </span>
                {owner.kind === "agent" ? (
                  <Badge variant={owner.claimed ? "default" : "warning"}>
                    {t(owner.claimed ? "authorAgent" : "authorUnverifiedAgent")}
                  </Badge>
                ) : null}
              </>
            ) : null}
            <a className={externalLinkClass} href={BRAND_URL} target="_blank" rel="noopener noreferrer">
              {t("madeWithWorkspace")}
              <span className="sr-only">{t("opensInNewTab")}</span>
              <ExternalLink aria-hidden="true" />
            </a>
            <a className={cn(externalLinkClass, "max-md:hidden")} href={HOSTED_URL} target="_blank" rel="noopener noreferrer">
              space.univer.ai
              <span className="sr-only">{t("opensInNewTab")}</span>
              <ExternalLink aria-hidden="true" />
            </a>
          </p>
          <div className="col-start-2 row-start-1 flex items-center gap-1">
            {nodeId ? <ReportNodeButton nodeId={nodeId} /> : null}
          </div>
          {offerSignUp ? (
            <nav aria-label={t("signUp")} className="col-span-full row-start-2 flex items-center gap-1">
              <Link
                to="/login"
                search={{ mode: "register", oauthError: undefined, returnTo: location.href }}
                className={cn(buttonVariants({ size: "sm" }), "no-underline")}
              >
                {t("signUpFree")}
              </Link>
              <Link
                to="/login"
                search={{ oauthError: undefined, returnTo: location.href }}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "no-underline")}
              >
                {t("signIn")}
              </Link>
              <Button variant="ghost" size="sm" onClick={copyLink}>
                <Copy aria-hidden="true" />
                {t("copyLink")}
              </Button>
            </nav>
          ) : null}
        </>
      ) : null}
      {offerSignUp ? (
        <>
          <Button
            variant="ghost"
            size={collapsed ? "sm" : "icon"}
            className={collapsed ? "rounded-full border border-border" : "col-start-3 row-start-1"}
            aria-label={t(collapsed ? "expandVisitorBar" : "collapseVisitorBar")}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            {collapsed ? (
              <><UniverCliIcon aria-hidden="true" />Univer Workspace<ChevronDown aria-hidden="true" /></>
            ) : <ChevronUp aria-hidden="true" />}
          </Button>
          <span role="status" className={cn("col-span-full text-xs text-muted-foreground", (collapsed || copyState === "idle") && "sr-only")}>
            {!collapsed && copyState !== "idle" ? t(copyState === "copied" ? "linkCopied" : "copyLinkFailed") : null}
          </span>
        </>
      ) : null}
    </aside>
  );
}
