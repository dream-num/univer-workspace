/**
 * The workspace-origin preference row in the General settings section.
 *
 * Reads the `univer-workspace-harness` settings namespace through
 * `ctx.settingsScope`, shows the effective Workspace origin, and lets the
 * user override it. Writes go through the settings scope's serialized
 * `set`/`unset`; clearing restores the deployment composition base.
 */
import { createElement, useEffect, useState } from "react";
import type { SettingsScope } from "@deepseek-ai/dsh-client-runtime/client";

/** The settings namespace shape mirrored from the host side. */
export interface WorkspaceAuthSettings {
  workspaceOrigin: string;
}

/** Callbacks supplied by the harness browser plugin. */
export interface OriginSettingProps {
  /** Bound settings scope for the `univer-workspace-harness` namespace. */
  scope: SettingsScope<WorkspaceAuthSettings>;
}

/** The field name inside the settings namespace. */
const ORIGIN_FIELD = "workspaceOrigin";

/** Render the origin preference row. */
export function OriginSetting({ scope }: OriginSettingProps) {
  const [value, setValue] = useState("");
  const [draft, setDraft] = useState("");
  const [overridden, setOverridden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const sync = (): void => {
      const snapshot = scope.getSnapshot();
      if (snapshot.status === "ready" && snapshot.value !== undefined) {
        setValue(snapshot.value.workspaceOrigin);
        setDraft(snapshot.value.workspaceOrigin);
        const user = snapshot.user as Partial<WorkspaceAuthSettings> | undefined;
        setOverridden(typeof user?.workspaceOrigin === "string");
      }
    };
    sync();
    const dispose = scope.subscribe(sync);
    return dispose;
  }, [scope]);

  const save = (): void => {
    const next = draft.trim();
    setBusy(true);
    setError(undefined);
    void scope.set(ORIGIN_FIELD, next).then(() => {
      setValue(next);
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => setBusy(false));
  };

  const clear = (): void => {
    setBusy(true);
    setError(undefined);
    void scope.unset(ORIGIN_FIELD).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => setBusy(false));
  };

  return createElement("div", { className: "uwh-originSetting" },
    createElement("div", null,
      createElement("strong", null, "Workspace 服务地址"),
      createElement("span", { className: "uwh-originHint" },
        overridden ? "已覆盖部署默认值，清除后恢复。" : "默认来自部署配置。",
      ),
      createElement("code", { className: "uwh-originValue" }, value),
    ),
    createElement("div", null,
      createElement("input", {
        type: "url",
        value: draft,
        disabled: busy,
        onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
      }),
      createElement("button", { type: "button", disabled: busy || draft.trim() === "", onClick: save }, "保存"),
      overridden && createElement("button", { type: "button", disabled: busy, onClick: clear }, "清除"),
      error !== undefined && createElement("span", { className: "uwh-originError" }, error),
    ),
  );
}
