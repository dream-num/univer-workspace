import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compatibility,
  decodeSkillText,
  RESERVED_SKILL_NAMES,
  scanSkill,
  verifyReview,
  type ScanContext,
  type ScanFile,
} from "./scan.js";
import type { ReviewFinding, StaticRule } from "./drafts.types.js";

const manifest = (extra = "", body = "Use Workspace.") =>
  `---\nname: weekly-report\ndescription: Build a weekly report.\n${extra}---\n${body}\n`;
const file = (path: string, text = "content"): ScanFile => ({ path, bytes: Buffer.from(text) });
const valid = () => [file("SKILL.md", manifest())];
interface Case {
  rule: StaticRule;
  positive: ScanFile[];
  negative?: ScanFile[];
  context?: ScanContext;
  name?: string;
}
const cases: Case[] = [
  { rule: "frontmatter-invalid", positive: [file("SKILL.md", "no frontmatter")] },
  {
    rule: "reserved-name",
    positive: [file("SKILL.md", manifest().replace("weekly-report", "core"))],
    name: "core",
  },
  { rule: "size-limit", positive: [file("SKILL.md", manifest("", "a".repeat(65536)))] },
  { rule: "unsafe-path", positive: [...valid(), file("../outside.md")] },
  {
    rule: "text-too-large",
    positive: [...valid(), file("references/large.md", "a".repeat(256 * 1024 + 1))],
  },
  { rule: "script-file", positive: [...valid(), file("scripts/example.txt")] },
  {
    rule: "facade-script",
    positive: [...valid(), file("code.ts", "univerAPI.getActiveWorkbook()")],
    negative: [...valid(), file("code.ts", "const x = 1")],
  },
  {
    rule: "executable-binary",
    positive: [...valid(), { path: "asset", bytes: Buffer.from("7f454c4600", "hex") }],
  },
  {
    rule: "office-asset",
    positive: [...valid(), { path: "assets/template.xlsx", bytes: Buffer.from([0, 255]) }],
  },
  {
    rule: "media-asset",
    positive: [...valid(), { path: "assets/logo.png", bytes: Buffer.from([0, 255]) }],
  },
  {
    rule: "missing-reference",
    positive: [
      file("SKILL.md", manifest("", "Read [guide](references/guide.md) and `scripts/check.py`.")),
    ],
    negative: [
      file("SKILL.md", manifest("", "Read [guide](references/guide.md).")),
      file("references/guide.md"),
    ],
  },
  { rule: "ignored-field", positive: [file("SKILL.md", manifest("allowed-tools: Read\n"))] },
  {
    rule: "hidden-text",
    positive: [...valid(), file("references/guide.md", "First\nHidden\u202e text")],
  },
  { rule: "name-conflict", positive: valid(), context: { nameConflict: true } },
  {
    rule: "hub-verdict",
    positive: valid(),
    context: { hubVerdict: { suspicious: true, message: "Hub marked this suspicious." } },
  },
];
describe("Skill static scan", () => {
  it.each(cases)(
    "detects $rule and does not flag its negative case",
    async ({ rule, positive, negative, context, name }) => {
      expect(
        (await scanSkill(name ?? "weekly-report", positive, context)).some(
          (finding) => finding.rule === rule,
        ),
      ).toBe(true);
      expect(
        (await scanSkill("weekly-report", negative ?? valid())).some(
          (finding) => finding.rule === rule,
        ),
      ).toBe(false);
    },
  );
  it.each(["code.js", "code.ts", "scripts/code.js", "scripts/code.ts"])(
    "reports only informational Facade code for %s",
    async (path) => {
      const findings = await scanSkill("weekly-report", [
        ...valid(),
        file(path, "#!/usr/bin/env node\nuniverAPI.getActiveWorkbook()"),
      ]);
      expect(findings.filter((finding) => finding.path === path)).toEqual([
        {
          rule: "facade-script",
          severity: "info",
          path,
          line: null,
          message: "Facade code can be passed to execute.",
        },
      ]);
      expect(compatibility(findings, [])).toBe("ready");
    },
  );
  it.each(["scripts/readme.txt", "code.js", "code.ts", "run.sh"])(
    "still warns for other script file %s",
    async (path) => {
      const findings = await scanSkill("weekly-report", [...valid(), file(path)]);
      expect(findings).toContainEqual(
        expect.objectContaining({ rule: "script-file", severity: "warn", path }),
      );
      expect(findings).not.toContainEqual(expect.objectContaining({ rule: "facade-script" }));
    },
  );
  it("does not flag gateway-supported invocation controls as ignored", async () => {
    const findings = await scanSkill("weekly-report", [
      file("SKILL.md", manifest("disable-model-invocation: true\nargument-hint: report name\n")),
    ]);
    expect(findings).not.toContainEqual(expect.objectContaining({ rule: "ignored-field" }));
    expect(findings).not.toContainEqual(expect.objectContaining({ rule: "frontmatter-invalid" }));
  });
  it.each([
    ["directory", "Read `scripts/` or [scripts](scripts/)."],
    ["placeholder", "Use `.agents/skills/<name>/` and [reference](references/<file>.md)."],
    ["extensionless directory", "Read `references` or [folder](references)."],
  ])("ignores %s references", async (_, body) => {
    expect(
      await scanSkill("weekly-report", [file("SKILL.md", manifest("", body))]),
    ).not.toContainEqual(expect.objectContaining({ rule: "missing-reference" }));
  });
  it("checks nested relative file paths in inline code", async () => {
    expect(
      await scanSkill("weekly-report", [
        file("SKILL.md", manifest("", "Read `docs/nested/guide.md`.")),
      ]),
    ).toContainEqual(expect.objectContaining({ rule: "missing-reference" }));
  });
  it("uses the gateway's assembled built-in names from repository files", () => {
    const script = new URL("../../../../../mcp/scripts/assemble-skills.mjs", import.meta.url);
    const source = readFileSync(script, "utf8");
    const assembled: string[] = [];
    // Execute the repository assembly recipe with read-only filesystem substitutes.
    const assemble = new Function(
      "cpSync",
      "mkdirSync",
      "rmSync",
      source
        .replace(/^import .* from "node:fs";\n/, "")
        .replaceAll("import.meta.url", JSON.stringify(script.href)),
    );
    assemble(
      (source: URL, target: URL) => {
        expect(existsSync(new URL("SKILL.md", source))).toBe(true);
        assembled.push(decodeURIComponent(target.pathname.split("/").filter(Boolean).at(-1)!));
      },
      () => {},
      () => {},
    );
    expect([...RESERVED_SKILL_NAMES].sort()).toEqual(assembled.sort());
  });
  it.each(["/absolute", "C:/drive", "x/../escape", "x\\escape", "x//empty", "x/./dot", "a\u0000b"])(
    "blocks unsafe path %s",
    async (path) => {
      expect(await scanSkill("weekly-report", [...valid(), file(path)])).toContainEqual(
        expect.objectContaining({ rule: "unsafe-path", severity: "block" }),
      );
    },
  );
  it("blocks symlinks, duplicate paths and file/directory collisions", async () => {
    for (const additions of [
      [{ ...file("linked"), symlink: true }],
      [file("duplicate"), file("duplicate")],
      [file("a"), file("a/b")],
    ]) {
      expect(await scanSkill("weekly-report", [...valid(), ...additions])).toContainEqual(
        expect.objectContaining({ rule: "unsafe-path" }),
      );
    }
  });
  it.each(["run.py", "run.sh", "run.ps1", "run.bat", "run.rb", "run.pl"])(
    "identifies script extension %s",
    async (path) => {
      expect(await scanSkill("weekly-report", [...valid(), file(path)])).toContainEqual(
        expect.objectContaining({ rule: "script-file" }),
      );
    },
  );
  it("identifies shebangs, HTML comments and zero width text", async () => {
    for (const text of ["#!/usr/bin/env python\nprint(1)", "<!-- hidden -->", "zero\u200bwidth"]) {
      expect(await scanSkill("weekly-report", [...valid(), file("notes", text)])).toContainEqual(
        expect.objectContaining({ rule: text.startsWith("#!") ? "script-file" : "hidden-text" }),
      );
    }
  });
  it.each(["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "4d5a0000"])(
    "identifies executable header %s",
    async (header) => {
      expect(
        await scanSkill("weekly-report", [
          ...valid(),
          { path: "asset", bytes: Buffer.from(header, "hex") },
        ]),
      ).toContainEqual(expect.objectContaining({ rule: "executable-binary" }));
    },
  );
  it("checks file count, binary and total limits", async () => {
    for (const files of [
      Array.from({ length: 101 }, (_, i) => file(`file${i}`)),
      [...valid(), { path: "binary", bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }],
      Array.from({ length: 3 }, (_, i) => ({
        path: `binary${i}`,
        bytes: Buffer.alloc(8 * 1024 * 1024),
      })),
    ]) {
      expect(await scanSkill("weekly-report", files)).toContainEqual(
        expect.objectContaining({ rule: "size-limit", severity: "block" }),
      );
    }
  });
  it("accepts string-map metadata and ignores remote links and ordinary inline code", async () => {
    const scan = await scanSkill("weekly-report", [
      file(
        "SKILL.md",
        manifest(
          "metadata:\n  source: github.com/example/skills\n",
          "[remote](https://example.com) `univerAPI`",
        ),
      ),
    ]);
    expect(scan).toEqual([]);
  });
  it("returns informational non-suspicious hub verdicts", async () => {
    expect(
      await scanSkill("weekly-report", valid(), {
        hubVerdict: { suspicious: false, message: "No hub flags." },
      }),
    ).toContainEqual(expect.objectContaining({ rule: "hub-verdict", severity: "info" }));
  });
  it("requires lossless UTF-8 and no NUL to count as text", () => {
    expect(decodeSkillText(Buffer.from("中文"))).toBe("中文");
    expect(decodeSkillText(Buffer.from([255]))).toBeNull();
    expect(decodeSkillText(Buffer.from([0]))).toBeNull();
  });
});
const review: ReviewFinding = {
  rule: "requires-shell",
  path: "SKILL.md",
  quote: "run python",
  impact: "Needs a shell.",
  suggestion: "Use execute.",
};
describe("Skill review evidence", () => {
  it("adds a 1-based line only to verbatim quotes and counts dropped evidence", () => {
    const verified = verifyReview(
      [file("SKILL.md", "First\nPlease run python now.\n")],
      [review, { ...review, quote: "Run Python" }, { ...review, path: "absent.md" }],
    );
    expect(verified).toEqual({
      review: [{ ...review, severity: "warn", line: 2 }],
      unverifiedReviewCount: 2,
    });
  });
  it("rejects quotes over 200 characters", () => {
    expect(() => verifyReview(valid(), [{ ...review, quote: "a".repeat(201) }])).toThrow(/200/);
  });
  it("derives blocked, degraded and ready compatibility", () => {
    expect(compatibility([], [])).toBe("ready");
    const info = {
      rule: "media-asset",
      severity: "info",
      path: "logo.png",
      line: null,
      message: "Image",
    } as const;
    expect(compatibility([info], [])).toBe("ready");
    expect(compatibility([{ ...info, severity: "warn" }], [])).toBe("degraded");
    expect(compatibility([], [{ ...review, line: 1, severity: "warn" }])).toBe("degraded");
    expect(
      compatibility([{ ...info, severity: "block" }], [{ ...review, line: 1, severity: "warn" }]),
    ).toBe("blocked");
  });
});
