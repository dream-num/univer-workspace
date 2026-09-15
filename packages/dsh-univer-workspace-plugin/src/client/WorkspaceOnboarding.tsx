import { startWorkspaceLogin, WorkspaceSignInButton } from "./workspace-login.tsx";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  Button,
  Input,
  OnboardingSurface,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { SettingsOnboardingOwnerProps } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import type { SettingsScope } from "./dsh-runtime-types.ts";
import type { WorkspaceAuthSettings } from "./OriginSetting.tsx";
import type { WorkspaceMeView } from "./workspace-contract.ts";
import css from "./WorkspaceOnboarding.module.scss";

interface ConnectionProps extends PropsLocale<"univer"> {
  loadMe: () => Promise<WorkspaceMeView>;
}

export function WorkspaceOnboarding({
  scope,
  loadMe,
  complete,
  t,
}: ConnectionProps &
  SettingsOnboardingOwnerProps & { scope: SettingsScope<WorkspaceAuthSettings> }) {
  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => scope.subscribe(listener), [scope]),
    useCallback(() => scope.getSnapshot(), [scope]),
  );
  const [phase, setPhase] = useState<"loading" | "disconnected" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [waiting, setWaiting] = useState(false);
  const origin = draft ?? snapshot.value?.workspaceOrigin ?? "";

  useEffect(() => {
    let live = true;
    setPhase("loading");
    void loadMe()
      .then((me) => {
        if (!live) return;
        if (me.connected) complete();
        else setPhase("disconnected");
      })
      .catch(() => {
        if (live) setPhase("error");
      });
    return () => {
      live = false;
    };
  }, [loadMe, complete, attempt]);

  const login = async () => {
    setBusy(true);
    setError(undefined);
    setWaiting(false);
    try {
      if (origin.trim() !== snapshot.value?.workspaceOrigin) {
        await scope.set("workspaceOrigin", origin.trim());
      }
      await startWorkspaceLogin();
      setWaiting(true);
    } catch {
      setError(t("settings.workspace.loginFailed"));
    } finally {
      // Keep retry available if the external browser is closed.
      setBusy(false);
    }
  };

  if (phase === "loading") return null;
  return (
    <OnboardingSurface>
      <section
        className={css.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-welcome-title"
      >
        <div className={css.brand}>Univer Workspace</div>
        <h1 id="workspace-welcome-title">{t("onboarding.title")}</h1>
        <p className={css.description}>{t("onboarding.description")}</p>
        {phase === "error" ? (
          <div role="alert">
            <p>{t("onboarding.connectionFailed")}</p>
            <Button onClick={() => setAttempt((value) => value + 1)}>{t("resource.retry")}</Button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void login();
            }}
          >
            <label className={css.field}>
              <span>{t("settings.workspace.origin")}</span>
              <Input
                type="url"
                required
                value={origin}
                disabled={busy || snapshot.status !== "ready"}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            {error && (
              <p className={css.error} role="alert">
                {error}
              </p>
            )}
            <Button
              className={css.login}
              type="submit"
              variant="primary"
              disabled={busy || !origin.trim() || snapshot.status !== "ready"}
            >
              {t("settings.workspace.login")}
            </Button>
          </form>
        )}
        {waiting && <p role="status">{t("settings.workspace.browserContinue")}</p>}
        <p className={css.hint}>{t("onboarding.modelHint")}</p>
        <Button disabled={busy} onClick={complete}>
          {t("onboarding.later")}
        </Button>
      </section>
    </OnboardingSurface>
  );
}

/** Keep a direct login action visible when the user defers first-run setup. */
export function WorkspaceLoginAction({ loadMe, wide, t }: ConnectionProps & { wide: boolean }) {
  const [disconnected, setDisconnected] = useState(false);
  useEffect(() => {
    let live = true;
    void loadMe()
      .then((me) => {
        if (live) setDisconnected(!me.connected);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [loadMe]);
  if (!disconnected) return null;
  return <div className={wide ? css.footer : undefined}><WorkspaceSignInButton t={t} compact={!wide} /></div>;
}
