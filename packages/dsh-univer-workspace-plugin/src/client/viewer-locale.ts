/**
 * Maps the active DSH locale id onto the Univer editor locale tags, mirroring
 * the dsh-univer-office viewer-locale pattern.
 * @module dsh-univer-workspace-plugin/client/viewer-locale
 */

import type { LocaleId } from "@deepseek-ai/dsh-client-locale/client";

/** Locale tags understood by the bundled Univer editor. */
export type ViewerLocale = "zh-CN" | "en-US";

/** Viewer-locale accessor injected into slot components. */
export interface ViewerLocaleInjected {
  readonly getViewerLocale: () => ViewerLocale;
}

const VIEWER_LOCALES = {
  zh: "zh-CN",
  en: "en-US",
} as const satisfies Record<string, ViewerLocale>;

/** Map one DSH locale id to the corresponding Univer editor locale tag. */
export function viewerLocaleOf(locale: LocaleId): ViewerLocale {
  return VIEWER_LOCALES[locale as keyof typeof VIEWER_LOCALES] ?? "en-US";
}
