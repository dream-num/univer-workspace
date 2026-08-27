/**
 * UI dictionaries for the plugin's browser surfaces, registered through the
 * DSH locale service (`ctx.locale.register`), following the dsh-univer-office
 * pattern: one namespace, zh as the key source, en typed against it.
 * @module dsh-univer-workspace-plugin/client/locales
 */

/** Simplified Chinese UI strings (the key source). */
export const zh = {
  'card.title': 'Univer 文档',
  'card.open': '预览',
  'card.readonly': '只读',
  'card.editable': '可编辑',
  'window.close': '关闭',
  'window.maximize': '放大',
  'window.restore': '还原',
  'window.loading': '正在加载文档…',
} as const

/** English UI strings. */
export const en: Record<keyof typeof zh, string> = {
  'card.title': 'Univer documents',
  'card.open': 'Preview',
  'card.readonly': 'read-only',
  'card.editable': 'editable',
  'window.close': 'Close',
  'window.maximize': 'Maximize',
  'window.restore': 'Restore',
  'window.loading': 'Loading document…',
}

/** Translation keys owned by this plugin's browser surfaces. */
export type UwhLocaleKey = keyof typeof zh

/** The plugin's locale namespace name. */
export const UWH_LOCALE_NAMESPACE = 'uwh'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Univer Workspace document cards and the floating viewer window. */
    uwh: UwhLocaleKey
  }
}
