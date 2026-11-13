import { CheckCircle2, CircleAlert, CircleX, Clock3, CircleDot, Info, TriangleAlert } from "lucide-react";
import type { Finding, SkillDraft } from "./review-model";

export const draftStates = {
  pending: { icon: CircleDot, tone: "open", label: { "en-US": "Pending review", "zh-CN": "待审阅" }, banner: { "en-US": "Review the files before publishing.", "zh-CN": "请审阅文件后再发布。" } },
  published: { icon: CheckCircle2, tone: "merged", label: { "en-US": "Published", "zh-CN": "已发布" }, banner: { "en-US": "This Skill is now available in Agents.", "zh-CN": "这个 Skill 现在可以在 Agents 中使用。" } },
  rejected: { icon: CircleX, tone: "danger", label: { "en-US": "Rejected", "zh-CN": "已拒绝" }, banner: { "en-US": "This draft was rejected. Ask the Agent for a new draft if you want to continue.", "zh-CN": "草稿已拒绝。如需继续，请让 Agent 重新起草。" } },
  expired: { icon: Clock3, tone: "neutral", label: { "en-US": "Expired", "zh-CN": "已过期" }, banner: { "en-US": "This draft expired before publication. Ask the Agent to create a fresh draft.", "zh-CN": "草稿在发布前已过期，请让 Agent 重新起草。" } },
  conflicted: { icon: CircleAlert, tone: "warn", label: { "en-US": "Conflicted", "zh-CN": "有冲突" }, banner: { "en-US": "The destination changed. Ask the Agent to redraft using the latest files.", "zh-CN": "目标位置已更改，请让 Agent 根据最新文件重新起草。" } },
} as const satisfies Record<SkillDraft["state"], { icon: typeof CheckCircle2; tone: string; label: Record<"en-US" | "zh-CN", string>; banner: Record<"en-US" | "zh-CN", string> }>;

export const findingSeverities = {
  block: { icon: CircleX, tone: "danger", label: { "en-US": "Blocking", "zh-CN": "阻止发布" } },
  warn: { icon: TriangleAlert, tone: "warn", label: { "en-US": "Warnings", "zh-CN": "警告" } },
  info: { icon: Info, tone: "neutral", label: { "en-US": "Information", "zh-CN": "提示" } },
} as const satisfies Record<Finding["severity"], { icon: typeof CircleX; tone: string; label: Record<"en-US" | "zh-CN", string> }>;

export const reviewRules = {
  "frontmatter-invalid": { "en-US": "Invalid Skill details", "zh-CN": "Skill 信息无效" },
  "reserved-name": { "en-US": "Name reserved for a built-in Skill", "zh-CN": "名称与内置 Skill 冲突" },
  "size-limit": { "en-US": "Skill exceeds the size limit", "zh-CN": "Skill 超出大小限制" },
  "unsafe-path": { "en-US": "Unsupported file path", "zh-CN": "文件路径不受支持" },
  "text-too-large": { "en-US": "Text file is too large", "zh-CN": "文本文件过大" },
  "script-file": { "en-US": "Script won't run", "zh-CN": "脚本不会运行" },
  "facade-script": { "en-US": "Run through Workspace tools", "zh-CN": "请通过 Workspace 工具执行" },
  "executable-binary": { "en-US": "Executable cannot run", "zh-CN": "可执行文件无法运行" },
  "office-asset": { "en-US": "Office file needs importing", "zh-CN": "Office 文件需要导入" },
  "media-asset": { "en-US": "Binary content is unavailable", "zh-CN": "二进制内容不可读" },
  "missing-reference": { "en-US": "Referenced file is missing", "zh-CN": "引用的文件不存在" },
  "ignored-field": { "en-US": "Field is not used", "zh-CN": "字段不会生效" },
  "hidden-text": { "en-US": "Hidden text needs review", "zh-CN": "隐藏文本需要审阅" },
  "name-conflict": { "en-US": "A Skill already uses this name", "zh-CN": "已有同名 Skill" },
  "hub-verdict": { "en-US": "Source review notice", "zh-CN": "来源审查提示" },
  "requires-shell": { "en-US": "Terminal required", "zh-CN": "需要终端" },
  "requires-binary": { "en-US": "External program required", "zh-CN": "需要外部程序" },
  "requires-local-io": { "en-US": "Local file access required", "zh-CN": "需要本地文件访问" },
  "unavailable-tool": { "en-US": "Tool is unavailable", "zh-CN": "工具不可用" },
  "suspicious-instruction": { "en-US": "Instruction needs review", "zh-CN": "指令需要审阅" },
} satisfies Record<Finding["rule"], Record<"en-US" | "zh-CN", string>>;

export const compatibilityStates = {
  ready: { icon: CheckCircle2, tone: "open", label: { "en-US": "Ready to review", "zh-CN": "可供审阅" } },
  degraded: { icon: TriangleAlert, tone: "warn", label: { "en-US": "Partly works in Workspace", "zh-CN": "在 Workspace 中部分可用" } },
  blocked: { icon: CircleAlert, tone: "danger", label: { "en-US": "Cannot publish", "zh-CN": "无法发布" } },
} as const satisfies Record<SkillDraft["compatibility"], { icon: typeof CheckCircle2; tone: string; label: Record<"en-US" | "zh-CN", string> }>;

export function collapseFindings(draft: Pick<SkillDraft, "scan" | "review">) {
  const groups = new Map<string, { finding: Finding; locations: Pick<Finding, "path" | "line">[] }>();
  for (const finding of [...draft.scan, ...draft.review]) {
    const key = JSON.stringify([finding.severity, finding.rule, "message" in finding ? finding.message : [finding.quote, finding.impact, finding.suggestion]]);
    const existing = groups.get(key);
    if (existing) existing.locations.push({ path: finding.path, line: finding.line });
    else groups.set(key, { finding, locations: [{ path: finding.path, line: finding.line }] });
  }
  const order = { block: 0, warn: 1, info: 2 };
  return [...groups.values()].sort((a, b) => order[a.finding.severity] - order[b.finding.severity]);
}

export function draftFileChange(draft: Pick<SkillDraft, "base">, file: SkillDraft["files"][number]) {
  const base = draft.base?.find((entry) => entry.path === file.path);
  if (!base) return "added";
  // Both manifests use the BlobStore content digest, quoted as a strong ETag in the base.
  return base.etag === `"${file.sha256}"` ? "unchanged" : "modified";
}

export function decodeSkillFile(bytes: ArrayBuffer) {
  let text: string | null = null;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!decoded.includes("\0")) text = decoded;
  } catch { /* Binary files have no source preview. */ }
  return { byteSize: bytes.byteLength, text };
}

export function formatSkillFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const megabytes = bytes >= 1024 * 1024;
  return `${Number((bytes / (megabytes ? 1024 * 1024 : 1024)).toFixed(1))} ${megabytes ? "MB" : "KB"}`;
}

export function skillFilesForReview(files: SkillDraft["files"]) {
  return [...files].sort((a, b) => Number(b.path === "SKILL.md") - Number(a.path === "SKILL.md"));
}
