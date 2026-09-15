import { useState } from "react";
import { Button, IconUserOutline16 } from "@deepseek-ai/dsh-client-ui-primitives";
import type { UniverLocaleKey } from "./locales.ts";
import type {} from "./desktop-host.ts";

export function isWorkspaceLoginRequired(error: unknown): boolean {
  return error instanceof Error && error.message === "workspace_connection_required";
}

export async function startWorkspaceLogin(): Promise<void> {
  if (window.workspaceDesktop?.login) await window.workspaceDesktop.login();
  else window.location.assign("/auth/oauth/start");
}

export function WorkspaceSignInButton({ t, compact = false }: { t: (key: UniverLocaleKey) => string; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"waiting" | "error">();
  return <div>
    <Button variant="primary" aria-label={t("settings.workspace.login")} title={t("settings.workspace.login")} disabled={busy} onClick={() => {
      setBusy(true);
      setStatus(undefined);
      void startWorkspaceLogin().then(() => setStatus("waiting"))
        .catch(() => setStatus("error")).finally(() => setBusy(false));
    }}><IconUserOutline16 />{!compact && t("settings.workspace.login")}</Button>
    {status && !compact && <p role={status === "error" ? "alert" : "status"}>
      {t(status === "error" ? "settings.workspace.loginFailed" : "settings.workspace.browserContinue")}
    </p>}
  </div>;
}
