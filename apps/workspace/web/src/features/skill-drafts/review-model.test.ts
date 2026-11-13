import { describe, expect, it } from "vitest";
import { compatibilityHeadline, groupFindings, lineDiff, skillPreview, type SkillDraft } from "./review-model";

describe("Skill draft review", () => {
  it("counts findings without claiming a review passed", () => {
    expect(compatibilityHeadline({ compatibility: "ready", scan: [], review: [] }, "en-US")).toBe(
      "Ready to review · No issues found",
    );
    expect(
      compatibilityHeadline(
        {
          compatibility: "blocked",
          scan: [
            {
              severity: "block",
              rule: "frontmatter-invalid",
              path: "SKILL.md",
              line: 1,
              message: "Invalid",
            },
          ],
          review: [],
        },
        "zh-CN",
      ),
    ).toBe("无法发布 · 发现 1 个问题");
  });
  it.each([
    [0, "Ready to review · No issues found", "可供审阅 · 未发现问题"],
    [1, "Partly works in Workspace · 1 issue found", "在 Workspace 中部分可用 · 发现 1 个问题"],
    [2, "Partly works in Workspace · 2 issues found", "在 Workspace 中部分可用 · 发现 2 个问题"],
  ])("formats %i findings in English and Chinese", (count, english, chinese) => {
    const scan = Array.from({ length: count }, () => ({ severity: "warn", rule: "script-file", path: "scripts/run.sh", line: null, message: "Script cannot run" } as const));
    const draft: Pick<SkillDraft, "compatibility" | "scan" | "review"> = { compatibility: count ? "degraded" : "ready", scan, review: [] };
    expect(compatibilityHeadline(draft, "en-US")).toBe(english);
    expect(compatibilityHeadline(draft, "zh-CN")).toBe(chinese);
  });
  it.each([
    ['"A quoted description: with punctuation."', "A quoted description: with punctuation."],
    ["'A single-quoted description.'", "A single-quoted description."],
    [">-\n  A folded\n  description.", "A folded description."],
  ])("separates YAML description %s from Markdown", async (yaml, description) => {
    const raw = `---\nname: preview-skill\ndescription: ${yaml}\n---\n# Instructions\n\nKeep this body.\n---\nAnd its rule.\n`;
    expect(await skillPreview("preview-skill", raw)).toEqual({ description, markdown: "# Instructions\n\nKeep this body.\n---\nAnd its rule.\n" });
  });
  it("strips a closed invalid frontmatter block without hiding body rules", async () => {
    expect(await skillPreview("preview-skill", "---\n---\n# Body\n---\n")).toEqual({ description: null, markdown: "# Body\n---\n" });
  });
  it("handles CRLF frontmatter and leaves absent or unclosed frontmatter readable", async () => {
    expect(await skillPreview("preview-skill", "---\r\nname: preview-skill\r\ndescription: Preview description.\r\n---\r\n# Body\r\n")).toEqual({ description: "Preview description.", markdown: "# Body\r\n" });
    for (const raw of ["# No frontmatter", "---\nname: preview-skill\n# Unclosed"]) {
      expect(await skillPreview("preview-skill", raw)).toEqual({ description: null, markdown: raw });
    }
  });
  it("groups static and verified review evidence by severity", () => {
    const block = {
      severity: "block",
      rule: "frontmatter-invalid",
      path: "SKILL.md",
      line: 1,
      message: "Invalid",
    } as const;
    const review = {
      severity: "warn",
      rule: "requires-shell",
      path: "SKILL.md",
      line: 3,
      quote: "run sh",
      impact: "Unavailable",
      suggestion: "Use tools",
    } as const;
    expect(groupFindings({ scan: [block], review: [review] })).toEqual({
      block: [block],
      warn: [review],
      info: [],
    });
  });
  it("shows additions, removals, repeated lines and final newlines", () => {
    expect(lineDiff("a\nb\na", "a\nc\na")).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "c" },
      { kind: "same", text: "a" },
    ]);
    expect(lineDiff("a", "a\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "add", text: "" },
    ]);
    expect(
      lineDiff("", "new")
        ?.filter((line) => line.kind !== "remove")
        .map((line) => line.text)
        .join("\n"),
    ).toBe("new");
  });
  it("reconstructs both versions from the diff", () => {
    for (const before of ["", "one", "one\ntwo\n", "x\nx\ny"]) {
      for (const after of ["", "two", "one\nthree\n", "y\nx\nx"]) {
        const diff = lineDiff(before, after);
        expect(
          diff
            ?.filter((line) => line.kind !== "add")
            .map((line) => line.text)
            .join("\n"),
        ).toBe(before);
        expect(
          diff
            ?.filter((line) => line.kind !== "remove")
            .map((line) => line.text)
            .join("\n"),
        ).toBe(after);
      }
    }
  });
  it("falls back for oversized contents and quadratic line counts", () => {
    expect(lineDiff("a".repeat(500_001), "b")).toBeNull();
    expect(lineDiff("a\n".repeat(501), "b\n".repeat(501))).toBeNull();
  });
});

it("shows pinned draft provenance and keeps unsafe hub links inert", async () => {
  const { draftProvenance } = await import("./review-model");
  const source = { kind: "git", hub: "skills-sh", owner: "anthropics", repo: "skills", commit: "a".repeat(40), path: "skills/pdf", pageUrl: "https://github.com/anthropics/skills/tree/main/skills/pdf" } as const;
  expect(draftProvenance(source)).toMatchObject({ hub: "skills-sh", href: source.pageUrl, detail: expect.stringContaining(source.commit) });
  expect(draftProvenance({ kind: "clawhub", owner: "owner", slug: "pdf", version: "1.0.0", pageUrl: "https://clawhub.ai/owner/skills/pdf" })).toMatchObject({ hub: "clawhub", href: "https://clawhub.ai/owner/skills/pdf" });
  expect(draftProvenance({ kind: "space", nodeId: "node-1", etag: "v1" })).toMatchObject({ hub: "space", href: "/nodes/node-1" });
  expect(draftProvenance({ ...source, pageUrl: "javascript:alert(1)" })?.href).toBeUndefined();
  expect(draftProvenance(null)).toBeNull();
});
