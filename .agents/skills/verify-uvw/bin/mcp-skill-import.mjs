#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("./verify-uvw", import.meta.url));
const { EVIDENCE, ORIGIN, VERIFY_UVW_RUN } = process.env;
assert(EVIDENCE && ORIGIN && VERIFY_UVW_RUN, 'Run eval "$($V env)" first.');
assert(process.argv.length === 2, "Usage: mcp-skill-import.mjs");
const sourceUrl = "https://github.com/anthropics/skills/tree/2c5958ecac7cee2b583967a2c4981d0f4a75c579/skills/pdf";
const save = (name, value) => writeFileSync(join(EVIDENCE, name), JSON.stringify(value, null, 2) + "\n");
const proof = { journey: "MR15", sourceUrl, assertions: "pending" };
function call(label, tool, input = {}) {
  execFileSync(helper, ["mcp", label, tool, JSON.stringify(input)], { stdio: "inherit", timeout: 120_000 });
  return JSON.parse(readFileSync(join(EVIDENCE, `${label}.out`), "utf8"));
}
function browser(...args) {
  try {
    return execFileSync("agent-browser", args, { encoding: "utf8", timeout: 60_000 });
  } catch {
    // Browser arguments can include the disposable password; keep them out of evidence.
    throw new Error(`agent-browser ${args[0]} failed. Inspect the browser snapshot.`);
  }
}
function screenshot(label) {
  writeFileSync(join(EVIDENCE, `${label}.txt`), browser("snapshot", "-c"));
  browser("screenshot", join(EVIDENCE, `${label}.png`), "--full");
}
async function rate(label) {
  const response = await fetch("https://api.github.com/rate_limit", { headers: { "user-agent": "verify-uvw-mr15", "cache-control": "no-cache" }, signal: AbortSignal.timeout(30_000) });
  const result = { status: response.status, date: response.headers.get("date"),
    "x-ratelimit-remaining": response.headers.get("x-ratelimit-remaining"),
    "x-ratelimit-reset": response.headers.get("x-ratelimit-reset"), body: await response.json() };
  save(`mr15-ratelimit-${label}.json`, result);
  assert.equal(response.status, 200);
  return result["x-ratelimit-remaining"];
}
try {
  proof.rateLimitBefore = await rate("before");
  const listed = call("mr15-candidates", "skill_source_read", { source: sourceUrl });
  const candidate = listed.candidates.find((entry) => entry.name === "pdf");
  assert(candidate, "Pinned source must contain pdf.");
  const selected = call("mr15-source", "skill_source_read", { source: listed.source, skill: candidate.path });
  assert(selected.scan.some((finding) => finding.rule === "script-file"));
  assert(selected.skill.files.some((file) => file.path.startsWith("scripts/")));
  const quote = selected.skill.content.split("\n").find((line) => /^\s*(?:python\b|from (?:pypdf|pdfplumber)\b|import (?:pypdf|pdfplumber)\b|pip\b)/.test(line) && line.trim() && line.length <= 200);
  assert(quote, "Use a verbatim line from the pinned PDF entry.");
  const review = [quote, "MR15 fabricated quote absent from the imported PDF entry."].map((quote) => ({
    rule: "requires-shell", path: "SKILL.md", quote,
    impact: "Workspace's browser agent cannot run the Python commands in this Skill.",
    suggestion: "Review the scripts and adapt unavailable steps before using this Skill.",
  }));
  const created = call("mr15-create", "skill_draft_create", {
    name: "pdf", destination: { personal: true }, from: { source: selected.source, skill: candidate.path },
    review, idempotency_key: `mr15-skill-import-${VERIFY_UVW_RUN}`,
  });
  const draft = created.draft;
  assert.equal(draft.state, "pending");
  assert.equal(draft.unverifiedReviewCount, 1);
  assert.equal(draft.review.length, 1);
  assert.equal(draft.review[0].quote, quote);
  assert(draft.review[0].line > 0);
  assert(draft.scan.some((finding) => finding.rule === "script-file"));
  assert(!draft.scan.some((finding) => finding.severity === "block"));
  assert.deepEqual(draft.source, selected.source);
  const before = call("mr15-before-publish", "skills_read");
  assert(!before.skills.some((skill) => skill.name === "pdf"));
  Object.assign(proof, { draftId: draft.id, previewUrl: draft.previewUrl, quote, verifiedLine: draft.review[0].line,
    unverifiedReviewCount: draft.unverifiedReviewCount, scriptFiles: draft.files.filter((file) => file.path.startsWith("scripts/")) });
  save("mr15-summary.json", proof);

  browser("open", `${ORIGIN}/login`);
  browser("storage", "local", "set", "univer-workspace-language", "en-US");
  browser("reload");
  browser("wait", "--text", "Username");
  browser("find", "label", "Username", "fill", `verify-${VERIFY_UVW_RUN}`);
  browser("find", "label", "Password", "fill", readFileSync(join(dirname(EVIDENCE), "user.pw"), "utf8").trim());
  browser("click", "form button[type=submit]");
  browser("wait", "--url", "**/home");
  browser("open", draft.previewUrl);
  browser("wait", "--text", "1 unverified");
  let page = browser("get", "text", "body");
  assert(page.includes("script-file") && page.includes(quote));
  assert(page.includes(`SKILL.md:${draft.review[0].line}`), "Verified review must display its line.");
  assert.equal(browser("eval", `document.querySelector('a[href="${sourceUrl}"]') !== null`).trim(), "true");
  screenshot("mr15-draft");
  browser("screenshot", join(EVIDENCE, "mr15-draft-header.png"));
  const scriptFile = draft.files.find((file) => file.path.startsWith("scripts/"));
  assert(scriptFile);
  browser("eval", `document.getElementById(${JSON.stringify(`skill-file-${encodeURIComponent(scriptFile.path)}`)})?.scrollIntoView({ block: "center" })`);
  browser("screenshot", join(EVIDENCE, "mr15-draft-files.png"));
  browser("find", "role", "button", "click", "--name", "Publish", "--exact");
  browser("wait", "--text", "Open Skill folder");
  screenshot("mr15-published");
  assert.equal(call("mr15-published-status", "skill_draft_get", { draft: draft.id }).draft.state, "published");
  const after = call("mr15-list", "skills_read");
  const imported = after.skills.find((skill) => skill.name === "pdf");
  assert.equal(imported?.metadata?.["source-hub"], "github");
  assert.equal(imported.metadata["source-commit"], selected.source.commit);
  for (const label of ["mr15-candidates", "mr15-source", "mr15-create", "mr15-published-status", "mr15-list"]) {
    for (const suffix of ["event.json", "gateway.log", "workspace.log"]) {
      const log = readFileSync(join(EVIDENCE, `${label}.${suffix}`), "utf8");
      assert(!log.includes(selected.skill.content) && !log.includes(quote) && !log.includes(review[1].quote), `${label}.${suffix} must not contain source or review text`);
    }
  }
  proof.metadata = imported.metadata;
  proof.assertions = "import-and-publication-passed";
  save("mr15-summary.json", proof);
  console.log("PASS MR15 source read, draft review and browser publication. Run rail proof as documented in features/mcp.md.");
} catch (error) {
  proof.error = error.message;
  throw error;
} finally {
  try { proof.rateLimitAfter = await rate("after"); }
  finally { save("mr15-summary.json", proof); }
}
