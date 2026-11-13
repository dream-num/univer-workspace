import { skillEntry } from "@modelcontextprotocol/server/ext/skills";
import { describe, expect, it } from "vitest";
import { importSkillFiles } from "./sources.metadata.js";
import type { ResolvedSource } from "./sources.types.js";

const git: ResolvedSource = {
  kind: "git",
  hub: "skills-sh",
  owner: "owner",
  repo: "repo",
  commit: "1".repeat(40),
  path: "skills/report",
  pageUrl: "https://github.com/owner/repo",
};
const claw: ResolvedSource = {
  kind: "clawhub",
  owner: "owner",
  slug: "report",
  version: "123",
  pageUrl: "https://clawhub.ai/owner/skills/report",
};
const fixedTime = Date.UTC(2026, 10, 13);
describe("import provenance", () => {
  it.each([git, claw])("keeps provenance values valid strings for $kind", async (source) => {
    const original =
      "---\nname: report\ndescription: Make a report.\nmetadata:\n  author: Test\n  source-version: old\n  source-commit: old\nlicense: MIT\n---\nKeep the body exactly.\n";
    const binary = new Uint8Array([0, 255, 12]);
    const files = await importSkillFiles({
      files: [
        { path: "SKILL.md", bytes: Buffer.from(original) },
        { path: "assets/x", bytes: binary },
      ],
      source,
      label: "repo",
      skill: "skills/report",
      name: "report",
      importedAt: fixedTime,
      overrides: [],
    });
    const result = Buffer.from(files.find((f) => f.path === "SKILL.md")!.bytes).toString("utf8");
    expect(result).toContain("license: MIT\n---\nKeep the body exactly.\n");
    expect(result).toContain("name: report\ndescription: Make a report.\n");
    expect(files.find((f) => f.path === "assets/x")!.bytes).toBe(binary);
    const parsed = await skillEntry("report", { "SKILL.md": result });
    expect(parsed.frontmatter.metadata).toMatchObject({
      author: "Test",
      "imported-at": "2026-11-13",
      "source-hub": source.kind === "git" ? "skills-sh" : "clawhub",
    });
    if (source.kind === "git") {
      expect(parsed.frontmatter.metadata).toMatchObject({
        source: "github.com/owner/repo/skills/report",
        "source-commit": "1".repeat(40),
      });
      expect(parsed.frontmatter.metadata).not.toHaveProperty("source-version");
    } else {
      expect(parsed.frontmatter.metadata).toMatchObject({
        source: "clawhub.ai/owner/skills/report",
        "source-version": "123",
      });
      expect(parsed.frontmatter.metadata).not.toHaveProperty("source-commit");
    }
  });
  it("rejects an oversized manifest override before parsing frontmatter", async () => {
    await expect(
      importSkillFiles({
        files: [],
        source: git,
        label: "repo",
        skill: "skills/report",
        name: "report",
        importedAt: fixedTime,
        overrides: [{ path: "SKILL.md", text: "x".repeat(65537) }],
      }),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("preserves comments and blank lines after metadata", async () => {
    const original =
      "---\nname: report\ndescription: Make a report.\nmetadata:\n  author: Test\n\n# License comment.\n\nlicense: MIT\n---\nBody\n";
    const [file] = await importSkillFiles({
      files: [{ path: "SKILL.md", bytes: Buffer.from(original) }],
      source: git,
      label: "repo",
      skill: "skills/report",
      name: "report",
      importedAt: fixedTime,
      overrides: [],
    });
    expect(Buffer.from(file!.bytes).toString()).toContain(
      "\n\n# License comment.\n\nlicense: MIT\n---\nBody\n",
    );
  });
  it("keeps CRLF and all bytes outside metadata", async () => {
    const original =
      "---\r\nname: report\r\ndescription: Make a report.\r\nmetadata: {author: Test}\r\nlicense: MIT\r\n---\r\nBody\r\n";
    const [file] = await importSkillFiles({
      files: [{ path: "SKILL.md", bytes: Buffer.from(original) }],
      source: git,
      label: "repo",
      skill: "skills/report",
      name: "report",
      importedAt: fixedTime,
      overrides: [],
    });
    const result = Buffer.from(file!.bytes).toString();
    expect(result.replace(/metadata:[^\r\n]+/, "metadata: OMITTED")).toBe(
      original.replace(/metadata:[^\r\n]+/, "metadata: OMITTED"),
    );
  });

  it("keeps a UTF-8 byte order mark", async () => {
    const original = "\ufeff---\nname: report\ndescription: Make a report.\n---\nBody\n";
    const [file] = await importSkillFiles({
      files: [{ path: "SKILL.md", bytes: Buffer.from(original) }],
      source: git,
      label: "repo",
      skill: "skills/report",
      name: "report",
      importedAt: fixedTime,
      overrides: [],
    });
    const bytes = Buffer.from(file!.bytes);
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(bytes.toString().replace(/\nmetadata:[^\n]+/, "")).toBe(original);
  });
});
