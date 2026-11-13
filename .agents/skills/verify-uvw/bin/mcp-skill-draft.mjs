#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("./verify-uvw", import.meta.url));
const { EVIDENCE, ORIGIN, VERIFY_UVW_RUN } = process.env;
assert(EVIDENCE && ORIGIN && VERIFY_UVW_RUN, 'Run eval "$($V env)" first.');
const username = process.argv[2] ?? `verify-${VERIFY_UVW_RUN}`;
assert(process.argv.length <= 3, "Usage: mcp-skill-draft.mjs [username]");
const name = "draft-weekly-report";
const content = `---\nname: ${name}\ndescription: Write a weekly report from Workspace sources.\n---\nRead source documents with MCP before writing the report.\n`;
const args = {
  name, destination: { personal: true }, files: [{ path: "SKILL.md", text: content }],
  review: [], idempotency_key: `mr14-${VERIFY_UVW_RUN}`,
};
function call(label, tool, input = {}) {
  execFileSync(helper, ["mcp", label, tool, JSON.stringify(input)], { stdio: "inherit" });
  return JSON.parse(readFileSync(join(EVIDENCE, `${label}.out`), "utf8"));
}
const first = call("mr14-create", "skill_draft_create", args);
assert.equal(first.draft.state, "pending");
assert.equal(first.draft.previewUrl, `${ORIGIN}/drafts/skills/${first.draft.id}`);
assert.equal(first.draft.compatibility, "ready");
const retry = call("mr14-retry", "skill_draft_create", args);
assert.deepEqual(retry, first);
const pending = call("mr14-pending", "skill_draft_get", { draft: first.draft.id });
assert.equal(pending.draft.state, "pending");
const before = call("mr14-before", "skills_read");
assert(!before.skills.some((skill) => skill.name === name), "An unpublished Skill must not exist.");

// Publication uses a fresh interactive login, never the MCP agent's downstream Session.
const password = readFileSync(join(dirname(EVIDENCE), "user.pw"), "utf8").trim();
const login = await fetch(`${ORIGIN}/api/auth/password/login`, {
  method: "POST", headers: { "content-type": "application/json", origin: ORIGIN },
  body: JSON.stringify({ username, password }), redirect: "error",
});
assert.equal(login.status, 200, "Interactive login must succeed.");
const cookie = login.headers.getSetCookie().map((part) => part.split(";", 1)[0]).join("; ");
assert(cookie, "Interactive login must return a Session cookie.");
try {
  const response = await fetch(`${ORIGIN}/api/skill-drafts/${first.draft.id}/publish`, {
    method: "POST", headers: { cookie, origin: ORIGIN }, redirect: "error",
  });
  const published = await response.json();
  writeFileSync(join(EVIDENCE, "mr14-publish.json"), `${JSON.stringify({ status: response.status, ...published }, null, 2)}\n`);
  assert.equal(response.status, 200);
  assert.equal(published.draft.state, "published");
} finally {
  const logout = await fetch(`${ORIGIN}/api/auth/logout`, { method: "POST", headers: { cookie, origin: ORIGIN } });
  assert.equal(logout.status, 204);
}
const published = call("mr14-published", "skill_draft_get", { draft: first.draft.id });
assert.equal(published.draft.state, "published");
const listed = call("mr14-list", "skills_read");
assert(listed.skills.some((skill) => skill.name === name && skill.source === "user"));
const read = call("mr14-read", "skills_read", { name });
assert.equal(read.source, "user");
assert.equal(read.content, content);
for (const label of ["mr14-create", "mr14-retry", "mr14-pending", "mr14-published"]) {
  const eventText = readFileSync(join(EVIDENCE, `${label}.event.json`), "utf8");
  const event = JSON.parse(eventText);
  assert.equal(event.outcome, "ok");
  assert.equal(event.executor, "none");
  assert.equal(event.repo, first.draft.spaceId);
  assert(!eventText.includes(content) && !eventText.includes("Read source documents"));
}
const summary = { journey: "MR14", assertions: "passed", draftId: first.draft.id,
  states: [pending.draft.state, published.draft.state], previewUrl: first.draft.previewUrl,
  publishStatus: 200, skill: name, source: read.source, contentMatches: true, idempotent: true };
writeFileSync(join(EVIDENCE, "mr14-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary));
