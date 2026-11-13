import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./agent-requests.mjs", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
function fixture(t, bodies) {
  const dir = mkdtempSync(join(tmpdir(), "agent-requests-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "requests.jsonl");
  const entries = [{ method: "OPTIONS", url: "/chat/completions", body: null }, { method: "GET", url: "/models", body: null },
    ...bodies.map((body) => ({ arrivedAt: "2026-11-13T00:00:00.000Z", method: "POST", url: "/chat/completions", body }))];
  writeFileSync(path, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return path;
}
const body = (user, system = "System\nSpace old\nEnd") => ({ messages: [{ role: "system", content: system }, { role: "user", content: user }], tools: [{ type: "function", function: { name: "skills_read" } }] });

for (const content of ["hello", [{ type: "text", text: "hel" }, { type: "text", text: "lo" }]]) {
  test(`requests normalizes ${typeof content} user content and keeps tool results`, (t) => {
    const first = body("earlier");
    const tool = { role: "tool", tool_call_id: "read-1", content: '{"content":"skill"}' };
    const second = body(content);
    second.messages.splice(1, 0, { role: "user", content: "earlier" }, tool);
    const result = run("requests", fixture(t, [first, second]));
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split("\n").map(JSON.parse);
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[1], { index: 2, arrivedAt: "2026-11-13T00:00:00.000Z", lastUser: "hello", toolResults: [tool] });
  });
}
test("prefix accepts appended messages with unchanged system and tools", (t) => {
  const first = body([{ type: "text", text: "hello" }]);
  const second = structuredClone(first);
  second.messages.push({ role: "assistant", content: "Done" }, { role: "user", content: "next" });
  const result = run("prefix", fixture(t, [first, second]), "1", "2");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /preserves/);
});
for (const field of ["system", "tools", "messages"]) {
  test(`prefix reports the first changed ${field}`, (t) => {
    const first = body("hello");
    const second = structuredClone(first);
    if (field === "system") second.messages[0].content = "Changed";
    if (field === "tools") second.tools[0].function.name = "different";
    if (field === "messages") second.messages[1].content = "Changed";
    const result = run("prefix", fixture(t, [first, second]), "1", "2");
    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`^${field}\\.`));
  });
}
test("system prints a line diff, selects requests, and replaces instance IDs", (t) => {
  const left = fixture(t, [body("hello"), body("next", [{ type: "text", text: "System\nSpace left\nEnd" }])]);
  const right = fixture(t, [body("hello", "System\nSpace right\nEnd")]);
  const result = run("system", `${left}:2`, right);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /@@ -2,1 \+2,1 @@\n-Space left\n\+Space right/);
  const equal = run("system", `${left}:2`, right, "--replace", "left=same", "--replace", "right=same");
  assert.equal(equal.status, 0, equal.stderr);
  assert.equal(equal.stdout.trim(), "System messages match.");
});
test("bad commands, missing indices, and malformed replacements fail clearly", (t) => {
  const log = fixture(t, [body("hello")]);
  for (const args of [["prefix", log, "0", "2"], ["system", log, log, "--replace", "oops"], ["requests"], ["unknown", log]]) {
    const result = run(...args);
    assert.equal(result.status, 2);
    assert.ok(result.stderr.trim());
  }
});
