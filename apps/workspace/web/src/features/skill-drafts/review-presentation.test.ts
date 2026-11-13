import { describe, expect, it } from "vitest";
import { skillDraftMessages } from "./messages";
import { collapseFindings, decodeSkillFile, compatibilityStates, draftFileChange, draftStates, findingSeverities, formatSkillFileSize, reviewRules, skillFilesForReview } from "./review-presentation";

describe("Skill review presentation", () => {
  it("gives every draft state a distinct decision result and the intended semantic tone", () => {
    expect(Object.fromEntries(Object.entries(draftStates).map(([key, value]) => [key, value.tone]))).toEqual({ pending: "open", published: "merged", rejected: "danger", expired: "neutral", conflicted: "warn" });
    for (const locale of ["en-US", "zh-CN"] as const) {
      for (const state of Object.values(draftStates)) expect(state.label[locale].length).toBeGreaterThan(0);
      expect(draftStates.conflicted.banner[locale]).toMatch(/Agent/);
      expect(draftStates.expired.banner[locale]).toMatch(/Agent/);
      for (const verdict of Object.values(compatibilityStates)) expect(verdict.label[locale]).not.toMatch(/safe|passed|安全|已通过/i);
    }
  });
  it("provides icons and localized titles for every severity and rule", () => {
    expect(Object.keys(findingSeverities)).toEqual(["block", "warn", "info"]);
    expect(Object.keys(reviewRules)).toHaveLength(20);
    for (const severity of Object.values(findingSeverities)) expect(severity.icon).toBeDefined();
    for (const title of Object.values(reviewRules)) {
      expect(title["en-US"].length).toBeGreaterThan(0);
      expect(title["zh-CN"].length).toBeGreaterThan(0);
    }
    expect(reviewRules["script-file"]).toEqual({ "en-US": "Script won't run", "zh-CN": "脚本不会运行" });
  });
  it("collapses matching warnings into eight navigable locations without losing evidence", () => {
    const scan = Array.from({ length: 8 }, (_, index) => ({ severity: "warn", rule: "script-file", path: `scripts/${index}.py`, line: null, message: "Workspace does not execute scripts." } as const));
    const groups = collapseFindings({ scan, review: [] });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.locations).toEqual(scan.map(({ path, line }) => ({ path, line })));
    expect(scan).toHaveLength(8);
  });
  it("keeps different messages, severities and review evidence separate, with blockers first", () => {
    const warning = { severity: "warn", rule: "script-file", path: "run.py", line: null, message: "Script cannot run" } as const;
    const review = { severity: "warn", rule: "requires-shell", path: "SKILL.md", line: 9, quote: "run sh", impact: "No shell", suggestion: "Use tools" } as const;
    const groups = collapseFindings({ scan: [warning, { ...warning, message: "Another message" }, { ...warning, severity: "block" }], review: [review, { ...review, path: "guide.md", line: 2 }, { ...review, suggestion: "Remove this step" }] });
    expect(groups).toHaveLength(5);
    expect(groups[0]?.finding.severity).toBe("block");
    expect(groups[3]).toEqual({ finding: review, locations: [{ path: "SKILL.md", line: 9 }, { path: "guide.md", line: 2 }] });
    expect(collapseFindings({ scan: [], review: [] })).toEqual([]);
  });
  it("marks content changes against the captured Blob digest", () => {
    const file = { path: "SKILL.md", sha256: "abc", byteSize: 12, kind: "text", mediaType: "text/plain" } as const;
    expect(draftFileChange({ base: null }, file)).toBe("added");
    expect(draftFileChange({ base: [{ path: file.path, resourceId: "resource", etag: '"abc"' }] }, file)).toBe("unchanged");
    expect(draftFileChange({ base: [{ path: file.path, resourceId: "resource", etag: '"before"' }] }, file)).toBe("modified");
  });
});

it("keeps exact base-file byte sizes and never shows binary bytes as source", () => {
  const text = new TextEncoder().encode("中文\n");
  expect(decodeSkillFile(text.buffer)).toEqual({ byteSize: 7, text: "中文\n" });
  for (const bytes of [new Uint8Array([0, 12]), new Uint8Array([255, 254])]) expect(decodeSkillFile(bytes.buffer)).toEqual({ byteSize: 2, text: null });
  expect(decodeSkillFile(new ArrayBuffer(0))).toEqual({ byteSize: 0, text: "" });
});

it("formats file sizes in bytes, kilobytes and megabytes", () => {
  expect(formatSkillFileSize(252)).toBe("252 B");
  expect(formatSkillFileSize(11_854)).toBe("11.6 KB");
  expect(formatSkillFileSize(2_202_010)).toBe("2.1 MB");
  expect(formatSkillFileSize(0)).toBe("0 B");
});

it("uses days for expiry from one day onward and pluralizes English file counts", () => {
  const en = skillDraftMessages["en-US"];
  const zh = skillDraftMessages["zh-CN"];
  expect(en.timeLeft(168)).toBe("Expires in 7 days");
  expect(zh.timeLeft(168)).toBe("7 天后过期");
  expect(en.timeLeft(24)).toBe("Expires in 1 day");
  expect(en.timeLeft(23)).toBe("Expires in 23 hours");
  expect(en.timeLeft(23.9)).toBe("Expires in 24 hours");
  expect(en.timeLeft(1)).toBe("Expires in 1 hour");
  expect(zh.timeLeft(23)).toBe("23 小时后过期");
  expect(en.files(1)).toBe("file");
  expect(en.files(12)).toBe("files");
  expect(zh.files(1)).toBe("文件");
  expect(zh.files(12)).toBe("文件");
});

it("pins SKILL.md first without changing other file order or the manifest", () => {
  const file = (path: string) => ({ path, sha256: "digest", byteSize: 1, kind: "text" as const, mediaType: "text/plain" });
  const files = [file("z.md"), file("a.md"), file("SKILL.md"), file("other.md")];
  expect(skillFilesForReview(files).map(({ path }) => path)).toEqual(["SKILL.md", "z.md", "a.md", "other.md"]);
  expect(files.map(({ path }) => path)).toEqual(["z.md", "a.md", "SKILL.md", "other.md"]);
  expect(skillDraftMessages["en-US"].blockedSummary(1)).toBe("1 blocking finding. Ask the Agent to revise the draft.");
  expect(skillDraftMessages["en-US"].blockedSummary(2)).toBe("2 blocking findings. Ask the Agent to revise the draft.");
  expect(skillDraftMessages["zh-CN"].blockedSummary(1)).toBe("有 1 个阻止发布的问题，请让 Agent 修改草稿。");
});
