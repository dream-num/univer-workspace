import { useEffect, useState } from "react";
import { Button, Input } from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import type { SettingsScope } from "./dsh-runtime-types.ts";
import { pollDeviceAuthorization } from "./device-authorization-poll.ts";
import css from "./OriginSetting.module.scss";

export interface WorkspaceAuthSettings {
  workspaceOrigin: string;
}

export interface OriginSettingProps extends PropsLocale<"univer"> {
  scope: SettingsScope<WorkspaceAuthSettings>;
}

interface ConnectionStatus {
  readonly connected?: unknown;
  readonly restartRequired?: unknown;
  readonly identity?: { readonly userId?: unknown };
}

async function waitForHarness(
  accepts: (status: ConnectionStatus) => boolean,
  timeoutMessage: string,
  timeoutMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("/api/uwh/me", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (response.ok && accepts((await response.json()) as ConnectionStatus)) return;
    } catch {
      // The supervised DSH child is intentionally unavailable during restart.
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
  const [pending, setPending] = useState<{
    deviceCode: string;
    userCode: string;
    verificationUrl: string;
    intervalMs: number;
    expiresAt: number;
  }>();
  const [account, setAccount] = useState<string>();
  const [pendingAccount, setPendingAccount] = useState<string>();
  const [restartRequired, setRestartRequired] = useState(false);
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
          pendingIdentity?: { username?: unknown; displayName?: unknown };
          restartRequired?: unknown;
        };
        const identity = body.identity;
        const label =
          typeof identity?.username === "string" ? identity.username : identity?.displayName;
        if (typeof label === "string") setAccount(label);
        const nextIdentity = body.pendingIdentity;
        const nextLabel =
          typeof nextIdentity?.username === "string"
            ? nextIdentity.username
            : nextIdentity?.displayName;
        if (typeof nextLabel === "string") setPendingAccount(nextLabel);
        setRestartRequired(body.restartRequired === true);
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

  const startDeviceLogin = (): void => {
    setBusy(true);
    setError(undefined);
    window.location.assign("/auth/oauth/start");
  };

  const completeDeviceLogin = (): void => {
    if (pending === undefined) return;
    setBusy(true);
    setError(undefined);
    void pollDeviceAuthorization({
      deviceCode: pending.deviceCode,
      intervalMs: pending.intervalMs,
      expiresAt: pending.expiresAt,
    })
      .then(async (body) => {
        const identity = body.identity as Record<string, unknown> | undefined;
        setPendingAccount(
          typeof identity?.username === "string"
            ? identity.username
            : t("settings.workspace.connectedFallback"),
        );
        setRestartRequired(body.restartRequired === true);
        setPending(undefined);
        setSwitching(true);
        const expectedUserId = typeof identity?.userId === "string" ? identity.userId : undefined;
        await waitForHarness(
          (status) =>
            status.connected === true &&
            status.restartRequired === false &&
            (expectedUserId === undefined || status.identity?.userId === expectedUserId),
          t("settings.workspace.restartTimeout"),
        );
        window.location.reload();
      })
      .catch(reportError)
      .finally(() => setBusy(false));
  };

  const logout = (): void => {
    setBusy(true);
    void fetch("/auth/device/logout", { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error(t("settings.workspace.logoutFailed"));
        setPendingAccount(undefined);
        setRestartRequired(true);
        setSwitching(true);
        await waitForHarness(
          (status) => status.connected === false && status.restartRequired === false,
          t("settings.workspace.restartTimeout"),
        );
        window.location.reload();
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
          <Button size="sm" variant="ghost" disabled={busy} onClick={startDeviceLogin}>
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
        {pending !== undefined && (
          <div className={css.deviceLogin} role="status">
            <span>{t("settings.workspace.code", { code: pending.userCode })}</span>
            <a href={pending.verificationUrl} target="_blank" rel="noreferrer">
              {t("settings.workspace.openAuthorization")}
            </a>
            <Button size="sm" variant="primary" disabled={busy} onClick={completeDeviceLogin}>
              {t("settings.workspace.completeAuthorization")}
            </Button>
          </div>
        )}
        {restartRequired && (
          <div className={css.restartNotice} role="status">
            <strong>
              {switching
                ? t("settings.workspace.switching")
                : t("settings.workspace.restartPending")}
            </strong>
            <span>
              {switching
                ? t("settings.workspace.restartRecovering")
                : pendingAccount === undefined
                  ? t("settings.workspace.restartDisconnecting")
                  : t("settings.workspace.restartSwitching", { account: pendingAccount })}
            </span>
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
