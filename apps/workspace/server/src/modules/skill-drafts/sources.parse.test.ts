import { describe, expect, it } from "vitest";
import { parseSkillSource } from "./sources.parse.js";

const sha = "2c5958ecac7cee2b583967a2c4981d0f4a75c579";
const git = {
  kind: "git",
  owner: "anthropics",
  repo: "skills",
  ref: "HEAD",
  path: "",
  hub: "github",
};
const skills = { ...git, hub: "skills-sh", skill: "pdf" };
const claw = { kind: "clawhub", owner: "steipete", slug: "gifgrep" };
describe("Skill source input forms", () => {
  it.each<[string, unknown]>([
    ["https://github.com/anthropics/skills", git],
    ["github.com/anthropics/skills.git/", git],
    ...["main", "v1.2.3", sha, "feature%2Fskills"].flatMap<[string, unknown]>((ref) => [
      [
        `https://github.com/anthropics/skills/tree/${ref}/skills/pdf`,
        { ...git, ref: decodeURIComponent(ref), path: "skills/pdf" },
      ],
      [
        `https://github.com/anthropics/skills/blob/${ref}/skills/pdf/SKILL.md`,
        { ...git, ref: decodeURIComponent(ref), path: "skills/pdf" },
      ],
    ]),
    ["https://skills.sh/anthropics/skills/pdf", skills],
    ["skills.sh/anthropics/skills/pdf", skills],
    ["anthropics/skills/pdf", skills],
    ["anthropics/skills@pdf", skills],
    ["npx skills add anthropics/skills --skill pdf", skills],
    ["npx -y skills add anthropics/skills --skill 'pdf' -g -y", skills],
    [
      "npx --yes skills@latest add https://github.com/anthropics/skills --skill pdf --global --yes",
      skills,
    ],
    ["npx skills add anthropics/skills/pdf", skills],
    ["npx skills add anthropics/skills", { ...git, hub: "skills-sh" }],
    ["https://clawhub.ai/steipete/skills/gifgrep", claw],
    ["clawhub.ai/steipete/gifgrep", claw],
    ["clawhub install steipete/gifgrep", claw],
    ["clawhub install @steipete/gifgrep --version 1.2.3", { ...claw, version: "1.2.3" }],
    ["clawhub install gifgrep --owner steipete", claw],
    ["clawhub install https://clawhub.ai/steipete/skills/gifgrep", claw],
    [
      "a987430d-e920-4f29-8f66-288af6399311",
      { kind: "space", nodeId: "a987430d-e920-4f29-8f66-288af6399311" },
    ],
  ])("parses %s", (input, expected) => expect(parseSkillSource(String(input))).toEqual(expected));
  it.each([
    "",
    "pdf",
    "https://example.com/skills",
    "http://github.com/a/b",
    "https://github.com.evil.test/a/b",
    "https://user:pass@github.com/a/b",
    "https://github.com:8443/a/b",
    "https://github.com/a/b?token=secret",
    "https://github.com/a/b#frag",
    "https://github.com/a/b/issues",
    "https://github.com/a/b/tree",
    "https://github.com/a/b/blob/main",
    "https://github.com/a/b/tree/main/%2e%2e/secret",
    "https://github.com/a/b/tree/main/a%5Cb",
    "https://skills.sh/a/b",
    "https://skills.sh/a/b/c/d",
    "https://domain.test/.well-known/skills/index.json",
    "a/b/../../etc",
    "npx skills add a/b --skill one two",
    "npx skills add a/b;curl bad",
    "npx skills remove a/b",
    "npx skills add a/b --unknown",
    "npx skills add a/b --skill",
    "clawhub install gifgrep",
    "clawhub install a/b --owner",
    "https://clawhub.ai/a/skills/b/extra",
    "file:///etc/passwd",
    "git@github.com:a/b.git",
  ])("rejects %s", (input) => expect(() => parseSkillSource(input)).toThrow());
});
