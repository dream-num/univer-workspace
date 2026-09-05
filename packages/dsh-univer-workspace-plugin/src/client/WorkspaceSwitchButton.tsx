/**
 * Cross-application navigation for the Harness shell.
 *
 * The Workspace app and Harness are separate origins and separate sessions;
 * this control is deliberately a plain same-origin-safe anchor with
 * `target="_blank"`, so opening it never mutates the current DSH session.
 */
import { useEffect, useState } from "react";
import { ExternalLinkIcon } from "@univerjs/univer-workspace-ui";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { InjectFace } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import css from "./WorkspaceSwitchButton.module.scss";

export interface WorkspaceSwitchInjected {
  readonly loadWorkspaceOrigin: () => Promise<string | undefined>;
}

type SessionProps = PropsRuntime<"conversation.session.header.utilities"> &
  PropsLocale<"univer"> &
  InjectFace<WorkspaceSwitchInjected>;

type FooterProps = PropsRuntime<"sidebar.footer.action"> &
  PropsLocale<"univer"> &
  InjectFace<WorkspaceSwitchInjected>;

function useOrigin(loadWorkspaceOrigin: () => Promise<string | undefined>): string | undefined {
  const [origin, setOrigin] = useState<string | undefined>();
  useEffect(() => {
    let live = true;
    void loadWorkspaceOrigin()
      .then((value) => {
        if (live) setOrigin(normalizeOrigin(value));
      })
      .catch(() => {
        // A missing/expired Workspace session should not leave a dead control
        // in the shell; the next authenticated bootstrap will retry on mount.
      });
    return () => {
      live = false;
    };
  }, [loadWorkspaceOrigin]);
  return origin;
}

function normalizeOrigin(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.pathname = url.pathname.replace(/\/+$/u, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return undefined;
  }
}

/** Session-header utility (visible once a real conversation header exists). */
export function WorkspaceHeaderSwitch({ loadWorkspaceOrigin, t }: SessionProps) {
  const origin = useOrigin(loadWorkspaceOrigin);
  if (origin === undefined) return null;
  return (
    <a
      className={css.switch}
      href={origin}
      target="_blank"
      rel="noopener noreferrer"
      title={t("workspace.openWorkspace")}
      aria-label={t("workspace.openWorkspace")}
    >
      <ExternalLinkIcon />
      <span>{t("workspace.workspace")}</span>
    </a>
  );
}

/** Sidebar-footer fallback (the conversation header is hidden in the blank hero). */
export function WorkspaceFooterSwitch({ wide, loadWorkspaceOrigin, t }: FooterProps) {
  const origin = useOrigin(loadWorkspaceOrigin);
  if (origin === undefined) return null;
  return (
    <a
      className={`${css.switch} ${css.footer}${wide ? "" : ` ${css.rail}`}`}
      href={origin}
      target="_blank"
      rel="noopener noreferrer"
      title={t("workspace.openWorkspace")}
      aria-label={t("workspace.openWorkspace")}
    >
      <ExternalLinkIcon />
      {wide ? <span>{t("workspace.workspace")}</span> : null}
    </a>
  );
}
