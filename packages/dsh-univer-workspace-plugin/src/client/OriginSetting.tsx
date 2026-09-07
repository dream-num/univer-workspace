import { useEffect, useState } from "react";
import { Button, Input } from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import type { SettingsScope } from "./dsh-runtime-types.ts";
import css from "./OriginSetting.module.scss";

export interface WorkspaceAuthSettings {
  workspaceOrigin: string;
}

export interface OriginSettingProps extends PropsLocale<"univer"> {
  scope: SettingsScope<WorkspaceAuthSettings>;
}

async function waitForConnection(timeoutMessage: string): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("/auth/connection/status", {
        cache: "no-store", signal: AbortSignal.timeout(3000),
      });
      if (response.ok && (await response.json() as { ready?: boolean }).ready === true) return;
    } catch {
      // Account-owned services can be unavailable briefly during a switch.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error(timeoutMessage);
}

export function OriginSetting({ scope, t }: OriginSettingProps) {
  const [value, setValue] = useState("");
  const [draft, setDraft] = useState("");
  const [overridden, setOverridden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [account, setAccount] = useState<string>();
  const [switching, setSwitching] = useState(false);

  const reportError = (reason: unknown): void => {
    const message = reason instanceof Error ? reason.message : String(reason);
    setError(
      message === "workspace_authorization_expired"
        ? t("settings.workspace.authorizationExpired")
        : message === "workspace_login_failed"
          ? t("settings.workspace.loginFailed")
          : message,
    );
  };

  useEffect(() => {
    const sync = (): void => {
      const snapshot = scope.getSnapshot();
      if (snapshot.status !== "ready" || snapshot.value === undefined) return;
      setValue(snapshot.value.workspaceOrigin);
      setDraft(snapshot.value.workspaceOrigin);
      setOverridden(
        typeof (snapshot.user as Partial<WorkspaceAuthSettings> | undefined)?.workspaceOrigin ===
          "string",
      );
    };
    sync();
    return scope.subscribe(sync);
  }, [scope]);

  useEffect(() => {
    void fetch("/api/uwh/me", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as {
          identity?: { username?: unknown; displayName?: unknown };
          switching?: unknown;
        };
        const identity = body.identity;
        const label =
          typeof identity?.username === "string" ? identity.username : identity?.displayName;
        if (typeof label === "string") setAccount(label);
        setSwitching(body.switching === true);
      })
      .catch(() => {
        // Connection status is advisory; Settings remains usable if it fails.
      });
  }, []);

  const save = (): void => {
    const next = draft.trim();
    setBusy(true);
    setError(undefined);
    void scope
      .set("workspaceOrigin", next)
      .then(() => {
        setValue(next);
      })
      .catch(reportError)
      .finally(() => setBusy(false));
  };

  const clear = (): void => {
    setBusy(true);
    setError(undefined);
    void scope
      .unset("workspaceOrigin")
      .then(() => setOverridden(false))
      .catch(reportError)
      .finally(() => setBusy(false));
  };

  const startLogin = (): void => {
    setBusy(true);
    setError(undefined);
    window.location.assign("/auth/oauth/start");
  };

  const logout = (): void => {
    setBusy(true);
    void fetch("/auth/device/logout", { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error(t("settings.workspace.logoutFailed"));
        setSwitching(true);
        await waitForConnection(t("settings.workspace.connectionTimeout"));
        window.location.replace("/");
      })
      .catch(reportError)
      .finally(() => setBusy(false));
  };

  return (
    <section className={css.setting} aria-label={t("settings.workspace.aria")}>
      <div className={css.summary}>
        <strong>{t("settings.workspace.origin")}</strong>
        <span className={css.hint}>
          {overridden
            ? t("settings.workspace.originOverride")
            : t("settings.workspace.originDefault")}
        </span>
        <code className={css.value}>{value}</code>
      </div>
      <div className={css.controls}>
        <Input
          type="url"
          value={draft}
          disabled={busy}
          aria-label={t("settings.workspace.origin")}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className={css.actions}>
          <Button size="sm" variant="primary" disabled={busy || draft.trim() === ""} onClick={save}>
            {t("settings.workspace.saveOrigin")}
          </Button>
          {overridden && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={clear}>
              {t("settings.workspace.restoreOrigin")}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={startLogin}>
            {t("settings.workspace.login")}
          </Button>
          {account !== undefined && (
            <span className={css.account}>{t("settings.workspace.connected", { account })}</span>
          )}
          {account !== undefined && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={logout}>
              {t("settings.workspace.logout")}
            </Button>
          )}
        </div>
        {switching && (
          <div className={css.restartNotice} role="status">
            <strong>{t("settings.workspace.switching")}</strong>
            <span>{t("settings.workspace.connectionUpdating")}</span>
          </div>
        )}
        {error !== undefined && (
          <span className={css.error} role="alert">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
