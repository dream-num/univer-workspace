import { skillEntry } from "@modelcontextprotocol/server/ext/skills";
import type { components } from "../../../../generated/http/schema";

export type SkillDraft = components["schemas"]["SkillDraft"];
export type Finding = SkillDraft["scan"][number] | SkillDraft["review"][number];

export function groupFindings(draft: Pick<SkillDraft, "scan" | "review">) {
  const groups: Record<Finding["severity"], Finding[]> = { block: [], warn: [], info: [] };
  for (const finding of [...draft.scan, ...draft.review]) groups[finding.severity].push(finding);
  return groups;
}

export function compatibilityHeadline(
  draft: Pick<SkillDraft, "compatibility" | "scan" | "review">,
  language: "en-US" | "zh-CN",
) {
  const count = draft.scan.length + draft.review.length;
  const labels =
    language === "zh-CN"
      ? { ready: "可用", degraded: "部分可用", blocked: "无法发布" }
      : { ready: "Available", degraded: "Partially available", blocked: "Cannot publish" };
  const findings =
    language === "zh-CN"
      ? count
        ? `发现 ${count} 个问题`
        : "未发现问题"
      : count
        ? `${count} ${count === 1 ? "issue" : "issues"} found`
        : "No issues found";
  return `${labels[draft.compatibility]} · ${findings}`;
}

export async function skillPreview(name: string, text: string) {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(text);
  const rest = opening ? text.slice(opening[0].length) : text;
  const closing = opening ? /^---[ \t]*(?:\r?\n|$)/m.exec(rest) : null;
  const markdown = closing ? rest.slice(closing.index + closing[0].length) : text;
  try {
    const entry = await skillEntry(name, { "SKILL.md": text });
    return { markdown, description: entry.frontmatter.description };
  } catch {
    return { markdown, description: null };
  }
}

export type DiffLine = { kind: "same" | "add" | "remove"; text: string };

export function lineDiff(current: string, proposed: string): DiffLine[] | null {
  const before = current.split("\n");
  const after = proposed.split("\n");
  // shortcut: bound quadratic LCS work; show both versions above this limit until a streaming diff is needed.
  if (current.length + proposed.length > 500_000 || before.length * after.length > 250_000)
    return null;
  const width = after.length + 1;
  const lengths = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      lengths[i * width + j] =
        before[i] === after[j]
          ? 1 + lengths[(i + 1) * width + j + 1]!
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      result.push({ kind: "same", text: before[i++]! });
      j++;
    } else if (
      i < before.length &&
      (j === after.length || lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)
    ) {
      result.push({ kind: "remove", text: before[i++]! });
    } else {
      result.push({ kind: "add", text: after[j++]! });
    }
  }
  return result;
}

export function draftProvenance(source: SkillDraft["source"]) {
  if (!source) return null;
  if (source.kind === "space") return { hub: "space" as const, href: `/nodes/${encodeURIComponent(source.nodeId)}`, detail: source.nodeId };
  const hub = source.kind === "git" ? source.hub : "clawhub";
  const detail = source.kind === "git" ? `${source.owner}/${source.repo} · ${source.commit} · ${source.path}`
    : `${source.owner}/${source.slug} · ${source.version}`;
  let href: string | undefined;
  try {
    const url = new URL(source.pageUrl);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["github.com", "skills.sh", "clawhub.ai"].includes(url.hostname)) href = url.href;
  } catch { /* A malformed source remains visible without a link. */ }
  return { hub, href, detail } as const;
}
