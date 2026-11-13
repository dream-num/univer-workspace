import { Link, useLocation } from "@tanstack/react-router";
import { UniverCliIcon } from "@univerjs/icons";
import { ChevronDown, ChevronUp, Copy } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../shared/i18n";
import { Button, buttonVariants } from "../shared/ui";
import { cn } from "../shared/utils/cn";

const STORAGE_KEY = "univer-workspace-visitor-bar-collapsed";

export function VisitorBar() {
  const { t } = useI18n();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
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
        collapsed ? "flex justify-end" : "grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 sm:flex sm:flex-wrap",
      )}
    >
      {!collapsed ? (
        <>
          <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground sm:flex-1">
            <UniverCliIcon aria-hidden="true" className="size-5 shrink-0 text-foreground" />
            {t("madeWithWorkspace")}
          </span>
          <nav aria-label={t("signUp")} className="col-span-2 row-start-2 flex items-center gap-1">
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
        </>
      ) : null}
      <Button
        variant="ghost"
        size={collapsed ? "sm" : "icon"}
        className={collapsed ? "rounded-full border border-border" : "col-start-2 row-start-1"}
        aria-label={t(collapsed ? "expandVisitorBar" : "collapseVisitorBar")}
        aria-expanded={!collapsed}
        onClick={toggleCollapsed}
      >
        {collapsed ? (
          <><UniverCliIcon aria-hidden="true" />Univer Workspace<ChevronDown aria-hidden="true" /></>
        ) : <ChevronUp aria-hidden="true" />}
      </Button>
      <span role="status" className={cn("col-span-2 text-xs text-muted-foreground", (collapsed || copyState === "idle") && "sr-only")}>
        {!collapsed && copyState !== "idle" ? t(copyState === "copied" ? "linkCopied" : "copyLinkFailed") : null}
      </span>
    </aside>
  );
}
