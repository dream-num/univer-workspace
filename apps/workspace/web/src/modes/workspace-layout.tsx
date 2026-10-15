import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { sessionQueryOptions } from "../features/auth";
import { useModeDefinition } from "./registry";
import type { WorkspaceShellProps as WorkspaceLayoutProps } from "./shell.types";
import { useI18n } from "../shared/i18n";
import { useUiMode } from "../shared/ui-mode";
import { buttonVariants, LoadingScreen } from "../shared/ui";
import { cn } from "../shared/utils/cn";

export { WorkspaceHeaderSearch } from "../features/shell";
export { CreateTeamDialog } from "../features/spaces";
export type { RepositoryTab, RepositoryBreadcrumb } from "./registry";

export function WorkspaceLayout(props: WorkspaceLayoutProps) {
  const { mode } = useUiMode();
  const { Shell } = useModeDefinition();
  const session = useQuery(sessionQueryOptions);
  if (session.isPending) return <LoadingScreen />;
  if (session.error) throw session.error;
  return session.data?.authenticated ? (
    <Shell key={mode} {...props} />
  ) : (
    <VisitorLayout {...props} />
  );
}

function VisitorLayout({
  children,
  headerTitle,
  headerContent,
  headerActions,
  immersive,
}: WorkspaceLayoutProps) {
  const { t } = useI18n();
  const location = useLocation();
  return (
    <div className="workspace-shell flex h-dvh flex-col overflow-hidden bg-background">
      <header
        style={{ display: immersive ? "none" : undefined }}
        className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2"
      >
        <span className="min-w-0 flex-1 truncate font-medium">
          {headerTitle ?? "Univer Workspace"}
        </span>
        {headerContent}
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Lock className="size-4" aria-hidden="true" />
          {t("readOnlyMode")}
        </span>
        {headerActions}
        <Link
          to="/login"
          search={{ oauthError: undefined, returnTo: location.href }}
          className={cn(buttonVariants({ size: "sm" }), "no-underline")}
        >
          {t("signIn")}
        </Link>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
