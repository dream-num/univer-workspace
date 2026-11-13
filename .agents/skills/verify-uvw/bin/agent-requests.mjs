#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isDeepStrictEqual, parseArgs } from "node:util";

const usage = "Usage: agent-requests.mjs requests <log> | prefix <log> <i> <j> | system <log>[:<i>] <log>[:<j>] [--replace <from>=<to> ...]";
const contentText = (content) => typeof content === "string" ? content : (content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("");
function requests(path) {
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line))
    .filter((entry) => entry.method === "POST" && entry.url === "/chat/completions");
}
function request(entries, index) {
  if (!/^[1-9]\d*$/.test(String(index)) || !entries[Number(index) - 1]) throw new Error(`No completion request ${index}`);
  return entries[Number(index) - 1].body;
}
function difference(left, right, path) {
  if (isDeepStrictEqual(left, right)) return;
  if (left && right && typeof left === "object" && typeof right === "object" && Array.isArray(left) === Array.isArray(right)) {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const found = difference(left[key], right[key], `${path}.${key}`);
      if (found) return found;
    }
  }
  return `${path}: ${JSON.stringify(left)} != ${JSON.stringify(right)}`;
}
function system(body) {
  const message = body.messages.find((message) => message.role === "system");
  if (!message) throw new Error("Request has no system message");
  return message;
}
function systemAt(spec) {
  const match = /^(.*):(\d+)$/.exec(spec);
  return contentText(system(request(requests(match ? match[1] : spec), match ? match[2] : 1)).content);
}

try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { replace: { type: "string", multiple: true } } });
  const [command, ...args] = positionals;
  if (values.replace && command !== "system") throw new Error(usage);
  if (command === "requests" && args.length === 1) {
    for (const [offset, entry] of requests(args[0]).entries()) {
      const lastUser = entry.body.messages.findLast((message) => message.role === "user");
      console.log(JSON.stringify({ index: offset + 1, arrivedAt: entry.arrivedAt,
        lastUser: lastUser ? contentText(lastUser.content) : null,
        toolResults: entry.body.messages.filter((message) => message.role === "tool") }));
    }
  } else if (command === "prefix" && args.length === 3) {
    const entries = requests(args[0]);
    const left = request(entries, args[1]);
    const right = request(entries, args[2]);
    const found = difference(system(left), system(right), "system")
      ?? difference(left.tools, right.tools, "tools")
      ?? difference(left.messages, right.messages.slice(0, left.messages.length), "messages");
    console.log(found ?? `Request ${args[2]} preserves request ${args[1]}'s system, tools, and messages prefix.`);
    process.exitCode = found ? 1 : 0;
  } else if (command === "system" && args.length === 2) {
    const replacements = (values.replace ?? []).map((value) => {
      const at = value.indexOf("=");
      if (at < 1) throw new Error("--replace needs a non-empty <from>=<to>");
      return [value.slice(0, at), value.slice(at + 1)];
    });
    const [left, right] = args.map((spec) => replacements.reduce((text, [from, to]) => text.split(from).join(to), systemAt(spec)).split("\n"));
    if (isDeepStrictEqual(left, right)) console.log("System messages match.");
    else {
      let start = 0;
      let end = 0;
      while (start < Math.min(left.length, right.length) && left[start] === right[start]) start++;
      while (end < Math.min(left.length, right.length) - start && left.at(-1 - end) === right.at(-1 - end)) end++;
      const removed = left.slice(start, left.length - end);
      const added = right.slice(start, right.length - end);
      console.log(`--- ${args[0]}\n+++ ${args[1]}\n@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@`);
      for (const line of removed) console.log(`-${line}`);
      for (const line of added) console.log(`+${line}`);
      process.exitCode = 1;
    }
  } else throw new Error(usage);
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
