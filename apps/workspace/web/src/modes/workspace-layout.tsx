import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import type { components } from "../../../generated/http/schema.js";
import { sessionQueryOptions } from "../features/auth";
import { nodeQueryOptions } from "../features/nodes/nodes.queries";
import { VisitorBar } from "./visitor-bar";
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
  const node = useQuery({ ...nodeQueryOptions(props.selectedNodeId ?? ""), enabled: props.selectedNodeId !== undefined });
  if (session.isPending) return <LoadingScreen />;
  if (session.error) throw session.error;
  if (!session.data?.authenticated) return <VisitorLayout {...props} owner={node.data?.owner} />;
  const detail = node.data;
  return (
    <Shell key={mode} {...props}>
      {/* A Personal Space has no members, so anyone there but its owner is an outside reader. */}
      {detail?.node.resource && detail.owner && detail.node.accessRole !== "owner" ? (
        <VisitorBar offerSignUp={false} nodeId={detail.node.id} owner={detail.owner} />
      ) : null}
      {props.children}
    </Shell>
  );
}

function VisitorLayout({
  children,
  headerTitle,
  headerContent,
  headerActions,
  immersive = false,
  selectedNodeId,
  owner,
}: WorkspaceLayoutProps & { readonly owner: components["schemas"]["NodeOwner"] | null | undefined }) {
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
          search={{ mode: "register", oauthError: undefined, returnTo: location.href }}
          className={cn(buttonVariants({ size: "sm" }), "no-underline")}
        >
          {t("signUp")}
        </Link>
        <Link
          to="/login"
          search={{ oauthError: undefined, returnTo: location.href }}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "no-underline")}
        >
          {t("signIn")}
        </Link>
      </header>
      {immersive || selectedNodeId ? (
        // The immersive view hides this header, so the bar carries sign-up there.
        <VisitorBar offerSignUp={immersive} nodeId={selectedNodeId} owner={owner} />
      ) : null}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
