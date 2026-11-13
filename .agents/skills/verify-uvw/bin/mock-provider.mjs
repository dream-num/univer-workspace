#!/usr/bin/env node
import http from "node:http";
import { appendFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { port: { type: "string" }, script: { type: "string" }, log: { type: "string" } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535 || !values.script || !values.log) {
  throw new Error("Usage: mock-provider.mjs --port <1-65535> --script <json-file> --log <jsonl-file>");
}
const script = JSON.parse(readFileSync(values.script, "utf8"));
if (typeof script.model !== "string" || !script.model || !Array.isArray(script.steps) || script.steps.some((step) =>
  !step || (typeof step.text === "string") === (step.tool !== undefined) || (step.tool !== undefined && !(typeof step.tool.name === "string" && step.tool.name &&
    step.tool.arguments && typeof step.tool.arguments === "object" && !Array.isArray(step.tool.arguments))))) {
  throw new Error('Script needs {model: string, steps: [{text: string} | {tool: {name: string, arguments: object}}]}');
}
let next = 0;
const server = http.createServer(async (req, res) => {
  const arrivedAt = new Date().toISOString();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  let closed = false;
  res.on("close", () => { closed = true; });
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; }
    catch {
      appendFileSync(values.log, JSON.stringify({ arrivedAt, method: req.method, url: req.url, body: raw }) + "\n");
      res.writeHead(400).end("Invalid JSON");
      return;
    }
    appendFileSync(values.log, JSON.stringify({ arrivedAt, method: req.method, url: req.url, body }) + "\n");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    if (req.method === "GET" && req.url === "/models") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: script.model, object: "model", created: 0, owned_by: "mock" }] }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/chat/completions") { res.writeHead(404).end(); return; }
    const index = next++;
    const step = script.steps[index] ?? { text: "Done" };
    const chunk = (delta, finish_reason) => ({ id: `mock-${index}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: script.model,
      choices: [{ index: 0, delta, finish_reason }] });
    const delta = step.tool ? { role: "assistant", tool_calls: [{ index: 0, id: `call-${index}`, type: "function", function: { name: step.tool.name, arguments: JSON.stringify(step.tool.arguments) } }] }
      : { role: "assistant", content: step.text };
    const chunks = [chunk(delta, null), chunk({}, step.tool ? "tool_calls" : "stop"),
      { ...chunk({}, null), choices: [], usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101, prompt_tokens_details: { cached_tokens: 50 } } }];
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    for (const value of chunks) {
      if (closed) return;
      res.write(`data: ${JSON.stringify(value)}\n\n`);
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (!closed) res.end("data: [DONE]\n\n");
  } catch (error) {
    if (!closed) {
      if (!res.headersSent) res.writeHead(500);
      res.end("Mock provider failed");
    }
    console.error(error);
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Mock provider listening on http://127.0.0.1:${port}`));
