import { Link, useLocation } from "@tanstack/react-router";
import { UniverCliIcon } from "@univerjs/icons";
import { Bot, ChevronDown, ChevronUp, Copy, CopyPlus, Flag, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import type { components } from "../../../generated/http/schema.js";
import { HandToAgentDialog } from "../features/nodes/hand-to-agent";
import { RemixDialog, useRemix } from "../features/nodes/remix";
import { ReportNodeDialog } from "../features/nodes/report-node-dialog";
import { useI18n } from "../shared/i18n";
import { Badge, Button, buttonVariants, MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "../shared/ui";
import { cn } from "../shared/utils/cn";

const STORAGE_KEY = "univer-workspace-visitor-bar-collapsed";
const BRAND_URL = "https://github.com/dream-num/univer-workspace";

type NodeOwner = components["schemas"]["NodeOwner"];

export function VisitorBar({
  offerSignUp,
  nodeId,
  owner,
  copyCount = 0,
  copyable = false,
}: {
  readonly offerSignUp: boolean;
  readonly nodeId: string | undefined;
  readonly owner: NodeOwner | null | undefined;
  readonly copyCount?: number | undefined;
  /** A file, as opposed to a folder, which cannot be copied. */
  readonly copyable?: boolean;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const [dialog, setDialog] = useState<"remix" | "handToAgent" | "report" | null>(null);
  const remix = useRemix(nodeId, () => setDialog("remix"));
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
        collapsed ? "flex justify-end" : "relative flex items-center gap-2",
      )}
    >
      {!collapsed ? (
        <>
          <p className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-xs text-muted-foreground">
            <a
              className="shrink-0 text-foreground"
              href={BRAND_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("madeWithWorkspace")}
              title={t("madeWithWorkspace")}
            >
              <UniverCliIcon aria-hidden="true" className="size-5" />
            </a>
            {owner ? (
              <>
                <span className="min-w-0 truncate font-medium text-foreground" title={author}>
                  {author}
                </span>
                {owner.kind === "agent" ? (
                  <Badge className="shrink-0" variant={owner.claimed ? "default" : "warning"}>
                    {t(owner.claimed ? "authorAgent" : "authorUnverifiedAgent")}
                  </Badge>
                ) : null}
              </>
            ) : null}
            {copyCount > 0 ? <span className="whitespace-nowrap">{t("copyCount", { count: copyCount })}</span> : null}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {offerSignUp ? (
              <nav aria-label={t("signUp")} className="flex items-center gap-1">
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
              </nav>
            ) : null}
            <MenuRoot>
              <MenuTrigger aria-label={t("moreActions")} render={<Button variant="ghost" size="icon" />}>
                <MoreHorizontal aria-hidden="true" />
              </MenuTrigger>
              <MenuContent align="end">
                {nodeId ? (
                  <>
                    {copyable ? (
                      <MenuItem disabled={remix.disabled} onClick={remix.remix}>
                        <CopyPlus aria-hidden="true" />
                        {t(remix.isPending ? "remixCopying" : "remix")}
                      </MenuItem>
                    ) : null}
                    <MenuItem onClick={() => setDialog("handToAgent")}>
                      <Bot aria-hidden="true" />
                      {t("handToMyAgent")}
                    </MenuItem>
                  </>
                ) : null}
                <MenuItem onClick={copyLink}>
                  <Copy aria-hidden="true" />
                  {t("copyLink")}
                </MenuItem>
                {nodeId ? (
                  <>
                    <MenuSeparator />
                    <MenuItem onClick={() => setDialog("report")}>
                      <Flag aria-hidden="true" />
                      {t("reportFile")}
                    </MenuItem>
                  </>
                ) : null}
              </MenuContent>
            </MenuRoot>
          </div>
        </>
      ) : null}
      {offerSignUp ? (
        <Button
          variant="ghost"
          size={collapsed ? "sm" : "icon"}
          className={collapsed ? "rounded-full border border-border" : "shrink-0"}
          aria-label={t(collapsed ? "expandVisitorBar" : "collapseVisitorBar")}
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
        >
          {collapsed ? (
            <><UniverCliIcon aria-hidden="true" />Univer Workspace<ChevronDown aria-hidden="true" /></>
          ) : <ChevronUp aria-hidden="true" />}
        </Button>
      ) : null}
      <span role="status" className={cn("absolute top-full right-3 z-10 bg-background text-xs text-muted-foreground", (collapsed || copyState === "idle") && "sr-only")}>
        {!collapsed && copyState !== "idle" ? t(copyState === "copied" ? "linkCopied" : "copyLinkFailed") : null}
      </span>
      {nodeId ? (
        <>
          <RemixDialog nodeId={nodeId} open={dialog === "remix"} onOpenChange={(open) => setDialog(open ? "remix" : null)} />
          <HandToAgentDialog nodeId={nodeId} open={dialog === "handToAgent"} onOpenChange={(open) => setDialog(open ? "handToAgent" : null)} />
          <ReportNodeDialog nodeId={nodeId} open={dialog === "report"} onOpenChange={(open) => setDialog(open ? "report" : null)} />
        </>
      ) : null}
    </aside>
  );
}
