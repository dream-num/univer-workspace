#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [action] = process.argv.slice(2);
assert(
  ["create", "replace", "check"].includes(action),
  "Usage: skill-drafts.mjs create|replace|check",
);
const run = `${process.env.VERIFY_UVW_ROOT}/${process.env.VERIFY_UVW_RUN}`;
const origin = process.env.ORIGIN;
const evidence = process.env.EVIDENCE;
assert(origin && evidence && process.env.VERIFY_UVW_RUN, 'Run eval "$($V env)" first');
const username = /^USERNAME=(.+)$/m.exec(readFileSync(`${run}/user.env`, "utf8"))[1];
const login = await fetch(`${origin}/api/auth/password/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username, password: readFileSync(`${run}/user.pw`, "utf8") }),
});
assert.equal(login.status, 200);
const cookie = login.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");
const helper = fileURLToPath(new URL("./verify-uvw", import.meta.url));
const space = JSON.parse(
  execFileSync(helper, ["uvw", "repo", "view", `${username}/personal`, "--json"], {
    encoding: "utf8",
  }),
);
const api = async (path, options = {}) => {
  const response = await fetch(origin + "/api" + path, {
    ...options,
    headers: { cookie, ...options.headers },
  });
  const result = await response.json();
  assert(response.ok, `${response.status} ${JSON.stringify(result)}`);
  return { status: response.status, ...result };
};
const body = (name, text) =>
  `---\nname: ${name}\ndescription: SB2 browser publication journey.\n---\n# Browser draft\n\n${text}\n`;
const create = async (label, input) => {
  const result = await api("/skill-drafts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": `verify-sb2-${process.env.VERIFY_UVW_RUN}-${label}`,
    },
    body: JSON.stringify({ spaceId: space.id, ...input }),
  });
  assert.equal(result.status, 201);
  writeFileSync(`${evidence}/sb2-${label}.json`, JSON.stringify(result, null, 2));
  console.log(
    `${label}: HTTP ${result.status}, ${result.draft.state}, ${result.draft.compatibility}, ${result.draft.previewPath}`,
  );
  return result.draft;
};
if (action === "create") {
  const valid = await create("draft", {
    name: "sb2-review",
    files: [
      {
        path: "SKILL.md",
        text: body(
          "sb2-review",
          "SB2_SKILL_BODY: summarize $ARGUMENTS.\nRead references/guide.md.\nUse the terminal to run the check.",
        ),
      },
      {
        path: "references/guide.md",
        text: "# Supporting reference\nUse Workspace tools for the summary.\n",
      },
    ],
    review: [
      {
        rule: "requires-shell",
        path: "SKILL.md",
        quote: "Use the terminal to run the check.",
        impact: "A terminal is unavailable in the browser Agent.",
        suggestion: "Use Workspace tools instead.",
      },
      {
        rule: "requires-shell",
        path: "SKILL.md",
        quote: "FAKE_QUOTE_DOES_NOT_EXIST",
        impact: "Unverified",
        suggestion: "Omit",
      },
    ],
  });
  assert.equal(valid.review.length, 1);
  assert.equal(valid.unverifiedReviewCount, 1);
  assert.equal(valid.review[0].line, 9);
  assert.equal(valid.compatibility, "degraded");
  const invalid = await create("invalid", {
    name: "sb2-invalid",
    files: [{ path: "SKILL.md", text: "# Missing frontmatter\nDo a summary." }],
  });
  assert(invalid.scan.some((finding) => finding.severity === "block"));
  assert.equal(invalid.compatibility, "blocked");
  await create("reject", {
    name: "sb2-reject",
    files: [{ path: "SKILL.md", text: body("sb2-reject", "Reject this draft.") }],
  });
  console.log(
    "AS16/AS17 fixtures asserted: verified line 9, 1 unverified, invalid frontmatter blocked.",
  );
} else if (action === "replace") {
  const replacement = await create("replace", {
    name: "sb2-review",
    replace: true,
    files: [
      { path: "SKILL.md", text: body("sb2-review", "SB2_REVISED_BODY: summarize $ARGUMENTS.") },
    ],
  });
  assert.deepEqual(replacement.removedPaths, ["references/guide.md"]);
  assert.equal(replacement.kind, "replace");
  assert.equal(replacement.base.length, 2);
  console.log("AS18: complete base has 2 files; references/guide.md will move to Trash.");
} else {
  for (const [label, expected] of [
    ["draft", "published"],
    ["reject", "rejected"],
  ]) {
    const fixture = JSON.parse(readFileSync(`${evidence}/sb2-${label}.json`, "utf8"));
    const result = await api(`/skill-drafts/${fixture.draft.id}`);
    assert.equal(result.draft.state, expected);
    writeFileSync(`${evidence}/sb2-${label}-readback.json`, JSON.stringify(result, null, 2));
    console.log(`AS${label === "draft" ? 19 : 20}: readback ${label}=${result.draft.state}`);
  }
}
