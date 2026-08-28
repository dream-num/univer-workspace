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
  openWorkspace: '打开 Workspace',
  workspace: 'Workspace',
  chooseSpace: '选择 Workspace 空间',
  chooseSpaceHint: '新会话将在所选空间中创建。',
  loadingSpaces: '正在加载空间…',
  spacesLoadFailed: '空间暂时无法加载，请稍后重试。',
  noSpaces: '暂无可用空间。',
  personalSpace: '个人空间',
  teamSpace: '团队空间',
  cancel: '取消',
  spaceNameInvalid: '空间名称应为 1 至 100 个字符。',
  spaceRenameForbidden: '你没有重命名此空间的权限。',
  spaceRenameFailed: '空间重命名失败，请稍后重试。',
  templates: '模板',
  templateForkFailed: '模板会话创建失败，请稍后重试。',
} as const

/** English UI strings. */
export const en: Record<keyof typeof zh, string> = {
  expand: 'Expand session list',
  loading: 'Loading profile…',
  adminBadge: 'Admin',
  workspaceLabel: 'Workspace',
  templateFork: 'Fork template',
  empty: 'No sessions yet; start with New Session above.',
  openWorkspace: 'Open Workspace',
  workspace: 'Workspace',
  chooseSpace: 'Choose Workspace Space',
  chooseSpaceHint: 'The new session will be created in the selected Space.',
  loadingSpaces: 'Loading Spaces…',
  spacesLoadFailed: 'Spaces are temporarily unavailable. Try again shortly.',
  noSpaces: 'No Spaces are available.',
  personalSpace: 'Personal Space',
  teamSpace: 'Team Space',
  cancel: 'Cancel',
  spaceNameInvalid: 'Space names must contain between 1 and 100 characters.',
  spaceRenameForbidden: 'You do not have permission to rename this Space.',
  spaceRenameFailed: 'The Space could not be renamed. Try again shortly.',
  templates: 'Templates',
  templateForkFailed: 'The template session could not be created. Try again shortly.',
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
