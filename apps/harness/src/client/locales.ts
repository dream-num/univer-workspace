/**
 * UI dictionaries for the harness sidebar surfaces, registered through the
 * DSH locale service (same mechanism as the capability plugin's cards).
 * @module @univerjs/univer-workspace-harness/client/locales
 */

/** Simplified Chinese UI strings (the key source). */
export const zh = {
  expand: '展开会话列表',
  loading: '正在读取用户信息…',
  adminBadge: '管理员',
  workspaceLabel: '工作区',
  templateFork: '从模板派生',
  empty: '暂无会话；使用侧栏上方的 New Session 开始。',
} as const

/** English UI strings. */
export const en: Record<keyof typeof zh, string> = {
  expand: 'Expand session list',
  loading: 'Loading profile…',
  adminBadge: 'Admin',
  workspaceLabel: 'Workspace',
  templateFork: 'Fork template',
  empty: 'No sessions yet; start with New Session above.',
}

/** Translation keys owned by the harness sidebar. */
export type HarnessLocaleKey = keyof typeof zh

/** The harness sidebar locale namespace name. */
export const HARNESS_LOCALE_NAMESPACE = 'univer-workspace-harness'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The harness sidebar session browser. */
    'univer-workspace-harness': HarnessLocaleKey
  }
}
