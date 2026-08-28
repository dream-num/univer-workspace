/**
 * Cross-application navigation for the Harness shell.
 *
 * The Workspace app and Harness are separate origins and separate sessions;
 * this control is deliberately a plain same-origin-safe anchor with
 * `target="_blank"`, so opening it never mutates the current DSH session.
 */
import { createElement, useEffect, useState } from "react";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { InjectFace } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type { HarnessLocaleKey } from "./locales.ts";

export interface WorkspaceSwitchInjected {
  readonly loadWorkspaceOrigin: () => Promise<string | undefined>;
}

type SessionProps = PropsRuntime<"conversation.session.header.utilities">
  & PropsLocale<"univer-workspace-harness">
  & InjectFace<WorkspaceSwitchInjected>;

type FooterProps = PropsRuntime<"sidebar.footer.action">
  & PropsLocale<"univer-workspace-harness">
  & InjectFace<WorkspaceSwitchInjected>;

/** A small external-link glyph kept independent of any host icon package. */
function ExternalIcon() {
  return createElement("svg", {
    viewBox: "0 0 16 16",
    width: 14,
    height: 14,
    "aria-hidden": "true",
    focusable: "false",
  },
  createElement("path", { d: "M6 3H3.75A1.75 1.75 0 0 0 2 4.75v7.5A1.75 1.75 0 0 0 3.75 14h7.5A1.75 1.75 0 0 0 13 12.25V10" }),
  createElement("path", { d: "M9 2h5v5M14 2 7.5 8.5" }));
}

function useOrigin(loadWorkspaceOrigin: () => Promise<string | undefined>): string | undefined {
  const [origin, setOrigin] = useState<string | undefined>();
  useEffect(() => {
    let live = true;
    void loadWorkspaceOrigin().then((value) => {
      if (live) setOrigin(normalizeOrigin(value));
    }).catch(() => {
      // A missing/expired Workspace session should not leave a dead control
      // in the shell; the next authenticated bootstrap will retry on mount.
    });
    return () => { live = false; };
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
  return createElement("a", {
    className: "uwh-workspaceSwitch",
    href: origin,
    target: "_blank",
    rel: "noopener noreferrer",
    title: t("openWorkspace" as HarnessLocaleKey),
    "aria-label": t("openWorkspace" as HarnessLocaleKey),
  }, createElement(ExternalIcon), createElement("span", null, t("workspace" as HarnessLocaleKey)));
}

/** Sidebar-footer fallback (the conversation header is hidden in the blank hero). */
export function WorkspaceFooterSwitch({ wide, loadWorkspaceOrigin, t }: FooterProps) {
  const origin = useOrigin(loadWorkspaceOrigin);
  if (origin === undefined) return null;
  return createElement("a", {
    className: `uwh-workspaceSwitch uwh-workspaceSwitchFooter${wide ? "" : " uwh-workspaceSwitchRail"}`,
    href: origin,
    target: "_blank",
    rel: "noopener noreferrer",
    title: t("openWorkspace" as HarnessLocaleKey),
    "aria-label": t("openWorkspace" as HarnessLocaleKey),
  }, createElement(ExternalIcon), wide ? createElement("span", null, t("workspace" as HarnessLocaleKey)) : null);
}
