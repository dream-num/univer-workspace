import { useI18n } from "../../../shared/i18n";

export const draftMessages = {
  "en-US": {
    publishPage: "Publish new page", replacePage: "Replace page", publish: "Publish", reject: "Reject",
    requestChanges: "Request changes", changeReason: "What should change?", sendChanges: "Send",
    changeDraftMessage: (name: string, reason: string) => `Revise draft “${name}”: ${reason}`,
    replaced: "A newer draft replaced this one",
    draftPreview: "Open draft preview", previewUnavailable: "Preview unavailable", previewFirst: "Open the draft preview before publishing.",
    draft: "Draft, not published", back: "Back", newVersion: "New", currentVersion: "Current", loading: "Loading…",
    repository: "Repository", destination: "Destination", root: "Repository root", scope: "Scope",
    sourceSheets: "Source Sheets", noSourceSheets: "No Sheet bindings", sourcesUnavailable: "Source Sheets could not be read.",
    publicPage: "Anyone with the link", privatePage: "Members only", unknownVisibility: "Visibility unavailable",
    publishNotice: "Publishing takes effect immediately. Draft preview changes are not saved.",
    pending: "Pending review", published: "Published", rejected: "Rejected", expired: "Expired",
    conflicted: "The page changed since the Agent drafted it. Ask the Agent to revise it.",
    notFound: "Draft not found or not yours.", openPage: "Open page",
  },
  "zh-CN": {
    publishPage: "发布新页面", replacePage: "替换页面", publish: "发布", reject: "拒绝",
    requestChanges: "要求修改", changeReason: "需要修改什么？", sendChanges: "发送",
    changeDraftMessage: (name: string, reason: string) => `修改草稿「${name}」：${reason}`,
    replaced: "已有更新的草稿",
    draftPreview: "打开草稿预览", previewUnavailable: "无法预览", previewFirst: "发布前请先打开草稿预览。",
    draft: "草稿，尚未发布", back: "返回", newVersion: "新版", currentVersion: "当前版本", loading: "加载中…",
    repository: "仓库", destination: "目标位置", root: "仓库根目录", scope: "范围",
    sourceSheets: "来源表格", noSourceSheets: "没有表格绑定", sourcesUnavailable: "无法读取来源表格。",
    publicPage: "任何有链接的人", privatePage: "仅成员可访问", unknownVisibility: "无法获取可见范围",
    publishNotice: "发布后立即生效。草稿预览中的修改不会保存。",
    pending: "等待审阅", published: "已发布", rejected: "已拒绝", expired: "已过期",
    conflicted: "页面在 Agent 起草后已更改，请让 Agent 修改草稿。",
    notFound: "草稿不存在或不属于你。", openPage: "打开页面",
  },
};

export function useDraftMessages() {
  return draftMessages[useI18n().language];
}
