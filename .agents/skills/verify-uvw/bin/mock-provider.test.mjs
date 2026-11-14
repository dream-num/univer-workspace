import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("mock provider holds a slow step and rejects an invalid delay", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mock-provider-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, "script.json");
  const log = join(dir, "requests.jsonl");
  const entry = fileURLToPath(new URL("./mock-provider.mjs", import.meta.url));
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const args = [entry, "--port", String(port), "--script", script, "--log", log];
  writeFileSync(script, JSON.stringify({ model: "mock-agent", steps: [{ text: "Slow step complete", delayMs: -1 }] }));
  assert.notEqual(spawnSync(process.execPath, args).status, 0);
  writeFileSync(script, JSON.stringify({ model: "mock-agent", steps: [{ text: "Slow step complete", delayMs: 1000 }] }));
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await once(child.stdout, "data");
  const body = fetch(`http://127.0.0.1:${port}/chat/completions`, { method: "POST", body: "{}" }).then((response) => response.text());
  assert.equal(await Promise.race([body, setTimeout(50, "pending")]), "pending");
  assert.match(await body, /Slow step complete/);
});


test("mock provider records exact raw requests and supports delayed errors and parallel tools", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mock-provider-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, "script.json");
  const log = join(dir, "requests.jsonl");
  const entry = fileURLToPath(new URL("./mock-provider.mjs", import.meta.url));
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const args = [entry, "--port", String(port), "--script", script, "--log", log];
  for (const step of [{ error: { status: 200, body: "bad" } }, { tools: [] }, { tools: [{ name: "test", arguments: [] }] }, { text: "ambiguous", error: { status: 500, body: "bad" } }]) {
    writeFileSync(script, JSON.stringify({ model: "mock-agent", steps: [step] }));
    assert.notEqual(spawnSync(process.execPath, args).status, 0);
  }
  const tools = [{ name: "repo_list", arguments: {} }, { name: "search", arguments: { query: "budget" } }];
  writeFileSync(script, JSON.stringify({ model: "mock-agent", steps: [{ error: { status: 500, body: "overloaded" }, delayMs: 200 }, { tools, delayMs: 200 }] }));
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await once(child.stdout, "data");
  const raw = '{ "messages": [{"role":"user","content":"hello"}] }';
  const request = () => fetch(`http://127.0.0.1:${port}/chat/completions`, { method: "POST", body: raw });
  const error = request();
  assert.equal(await Promise.race([error, setTimeout(30, "pending")]), "pending");
  const response = await error;
  assert.equal(response.status, 500);
  assert.equal(await response.text(), "overloaded");
  const parallel = request().then((value) => value.text());
  assert.equal(await Promise.race([parallel, setTimeout(30, "pending")]), "pending");
  const chunks = (await parallel).split("\n\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
  const calls = chunks[0].choices[0].delta.tool_calls;
  assert.deepEqual(calls.map((call) => ({ name: call.function.name, arguments: JSON.parse(call.function.arguments) })), tools);
  assert.equal(calls[0].id, "call-1");
  assert.equal(new Set(calls.map((call) => call.id)).size, 2);
  assert.equal(chunks[1].choices[0].finish_reason, "tool_calls");
  const rows = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(rows.map((row) => row.raw), [raw, raw]);
  assert.deepEqual(rows.map((row) => row.body), [JSON.parse(raw), JSON.parse(raw)]);
});


test("round2 mock provider preserves UTF-8 split across request chunks", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mock-provider-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, "script.json");
  const log = join(dir, "requests.jsonl");
  writeFileSync(script, JSON.stringify({ model: "mock-agent", steps: [] }));
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL("./mock-provider.mjs", import.meta.url)), "--port", String(port), "--script", script, "--log", log], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await once(child.stdout, "data");
  const sent = JSON.stringify({ messages: [{ role: "user", content: "你好😀".repeat(100) }] });
  const bytes = Buffer.from(sent);
  const split = bytes.indexOf(Buffer.from("你")) + 1;
  const request = httpRequest(`http://127.0.0.1:${port}/chat/completions`, { method: "POST" });
  const response = once(request, "response").then(async ([response]) => {
    for await (const _chunk of response) {}
    return response.statusCode;
  });
  request.write(bytes.subarray(0, split));
  await setTimeout(30);
  request.end(bytes.subarray(split));
  assert.equal(await response, 200);
  const row = JSON.parse(readFileSync(log, "utf8").trim());
  assert.equal(row.raw, sent);
  assert.deepEqual(row.body, JSON.parse(sent));
});
