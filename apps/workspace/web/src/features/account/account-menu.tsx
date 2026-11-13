import { ChevronDown, KeyRound, Lock, LogOut, Settings, User } from "lucide-react";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { loadAgentsUi } from "../agents";
import { useI18n } from "../../shared/i18n";
import { Avatar, MenuContent, MenuGroup, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "../../shared/ui";
import type { components } from "../../../../generated/http/schema.js";

const AgentAccount = lazy(() => loadAgentsUi().then((ui) => ({ default: ui.AgentAccountDialog })));

export function AccountMenu({ currentSession, onProfile, onPassword, onAccessTokens, extraItems, logoutPending, onLogout }: {
  readonly currentSession: components["schemas"]["AuthenticatedSession"];
  readonly onProfile: () => void;
  readonly onPassword: () => void;
  readonly onAccessTokens: () => void;
  readonly extraItems: ReactNode;
  readonly logoutPending: boolean;
  readonly onLogout: () => void;
}) {
  const { t } = useI18n();
  const [agentAction, setAgentAction] = useState<"settings" | "logout" | null>(null);
  return (
    <MenuRoot>
      <MenuTrigger
        aria-label={t("account")}
        render={
          <button
            type="button"
            className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full py-1 pr-2 pl-1 transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Avatar
              src={currentSession.user.avatarUrl}
              name={currentSession.user.displayName}
            />
            <ChevronDown className="size-3 text-subtle-foreground" />
          </button>
        }
      />
      <MenuContent align="end" className="w-56">
        <div className="grid gap-0.5 px-2.5 py-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {currentSession.user.displayName}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            @{currentSession.user.username}
          </span>
        </div>
        <MenuSeparator />
        <MenuGroup>
          <MenuItem onClick={() => onProfile()}>
            <User />
            {t("profile")}
          </MenuItem>
          {currentSession.passwordAuthEnabled &&
          currentSession.authenticationMethods.password ? (
            <MenuItem onClick={() => onPassword()}>
              <Lock />
              {t("changePassword")}
            </MenuItem>
          ) : null}
          <MenuItem onClick={onAccessTokens}>
            <KeyRound />
            {t("accessTokens")}
          </MenuItem>
          <MenuItem onClick={() => setAgentAction("settings")}>
            <Settings />
            {t("modelSettings")}
          </MenuItem>
          {extraItems}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem
          className="text-destructive data-highlighted:bg-destructive-soft data-highlighted:text-destructive [&_svg]:text-destructive"
          disabled={logoutPending}
          onClick={() => { void loadAgentsUi().then(() => setAgentAction("logout")).catch(() => onLogout()); }}
        >
          <LogOut />
          {t("signOut")}
        </MenuItem>
      </MenuContent>
      {agentAction ? (
        <Suspense fallback={null}>
          <AgentAccount action={agentAction} onClose={() => setAgentAction(null)} onLogout={onLogout} />
        </Suspense>
      ) : null}
    </MenuRoot>
  );
}
