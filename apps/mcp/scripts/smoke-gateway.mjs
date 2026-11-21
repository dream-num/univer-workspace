#!/usr/bin/env node
// Smoke test for a running MCP gateway: HTTP surfaces, then one real MCP session over
// Streamable HTTP. With a Workspace token it lists tools, calls whoami, and can read a real
// Unit and take a screenshot through the executor and the renderer.
//
//   node apps/mcp/scripts/smoke-gateway.mjs --url http://127.0.0.1:3009 --token <bearer>
//
// The gateway only answers /mcp when the Host header equals MCP_PUBLIC_URL. For local testing
// start it with MCP_PUBLIC_URL=http://127.0.0.1:3009/mcp (see the hint this script prints when
// the configured public URL points somewhere else).
//
// Exit codes: 0 required checks passed, 1 a required check failed, 2 unreachable or bad usage.

import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const { Client, StreamableHTTPClientTransport } = require("@modelcontextprotocol/client");

const REQUEST_TIMEOUT_MS = 10_000;

const { values: options } = parseArgs({
  allowPositionals: false,
  options: {
    url: { type: "string", default: process.env["MCP_GATEWAY_URL"] ?? "http://127.0.0.1:3009" },
    token: {
      type: "string",
      default: process.env["MCP_TOKEN"] ?? process.env["WORKSPACE_SESSION"],
    },
    "metrics-token": { type: "string", default: process.env["METRICS_TOKEN"] },
    "worktree-id": { type: "string" },
    "unit-id": { type: "string" },
    trunk: { type: "boolean", default: false },
    target: { type: "string", default: "workbook" },
    screenshot: { type: "boolean", default: false },
    toolsets: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (options.help) {
  process.stdout.write(
    [
      "Usage: node apps/mcp/scripts/smoke-gateway.mjs [options]",
      "",
      "  --url <origin>          gateway origin (default http://127.0.0.1:3009)",
      "  --token <bearer>        PAT, OAuth token or development Workspace session",
      "  --metrics-token <tok>   METRICS_TOKEN, to check /metrics",
      "  --toolsets <list>       request /mcp?toolsets=<list>",
      "  --worktree-id <id>      with --unit-id, read a real Unit through the gateway",
      "  --unit-id <id>          Unit inside --worktree-id",
      "  --trunk                 read the Unit from trunk instead of a Worktree",
      "  --target <name>         inspect target, default workbook",
      "  --screenshot            also call screenshot and wait for the image",
      "",
      "Without --token only the HTTP surfaces are checked.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const origin = options.url.replace(/\/+$/u, "");
const base = new URL(origin);
const token = options.token;

const results = [];

async function check(name, run, { optional = false } = {}) {
  try {
    const detail = await run();
    results.push({ name, ok: true, optional, detail: detail ?? "" });
  } catch (error) {
    results.push({
      name,
      ok: false,
      optional,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function skip(name, detail) {
  results.push({ name, ok: true, optional: true, skipped: true, detail });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected)
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value, got ${JSON.stringify(value)}`);
}

async function get(path, init = {}) {
  const response = await fetch(new URL(path, origin), {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, text, json };
}

// --- HTTP surfaces -------------------------------------------------------------------------

let reachable = false;
await check("gateway answers /healthz", async () => {
  const response = await get("/healthz", { method: "GET" });
  assertEqual(response.status, 200, "status");
  reachable = true;
});

if (!reachable) {
  process.stderr.write(`Cannot reach ${origin}. Is the gateway listening on that port?\n`);
  process.exit(2);
}

let readyChecks = {};
await check("gateway readiness (/readyz)", async () => {
  const response = await get("/readyz");
  assertTruthy(response.json, "JSON body");
  readyChecks = response.json.checks ?? {};
  const failing = Object.entries(readyChecks)
    .filter(([, value]) => value !== "ok")
    .map(([name]) => name);
  const detail = Object.entries(readyChecks)
    .map(([name, value]) => `${name}=${value}`)
    .join(", ");
  if (failing.includes("executor"))
    throw new Error(
      `${detail}: the gateway cannot discover the executor. Check MCP_EXECUTOR_URLS and ` +
        "MCP_EXECUTOR_TOKEN, and that the same URL answers " +
        "GET /rpc/v1/capabilities with that token",
    );
  if (failing.length > 0) throw new Error(detail);
  return detail;
});

let publicResource;
await check("published resource metadata (/.well-known)", async () => {
  const response = await get("/.well-known/oauth-protected-resource/mcp");
  assertEqual(response.status, 200, "status");
  publicResource = response.json?.resource;
  assertTruthy(publicResource, "resource");
  return `${publicResource}, scopes ${(response.json.scopes_supported ?? []).join(",")}`;
});

await check("MCP endpoint is reachable at this origin", async () => {
  const response = await get("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "smoke-gateway", version: "0" },
      },
    }),
  });
  if (response.status === 403)
    throw new Error(
      `403 Forbidden: the gateway compares Host with MCP_PUBLIC_URL (${publicResource ?? "unknown"}). ` +
        `Restart it with MCP_PUBLIC_URL=${origin}/mcp for local testing.`,
    );
  assertEqual(response.status, 401, "status without a bearer");
  const challenge = response.headers.get("www-authenticate") ?? "";
  assertTruthy(challenge.includes("resource_metadata"), "WWW-Authenticate challenge");
  return "401 with an OAuth challenge, as expected without a token";
});

if (options["metrics-token"] === undefined) {
  skip("/metrics", "pass --metrics-token to check it");
} else {
  await check("/metrics serves the gateway registry", async () => {
    const response = await get("/metrics", {
      method: "GET",
      headers: { authorization: `Bearer ${options["metrics-token"]}` },
    });
    assertEqual(response.status, 200, "status");
    assertTruthy(response.text.includes("mcp_tool_calls_total"), "mcp_tool_calls_total");
    return `${response.text.length} bytes`;
  });
}

// --- MCP session ---------------------------------------------------------------------------

if (token === undefined) {
  for (const name of ["MCP session", "tools/list", "whoami", "inspect", "screenshot"])
    skip(name, "pass --token (PAT, OAuth token or development session)");
} else {
  const endpoint = new URL(`${origin}/mcp`);
  if (options.toolsets !== undefined) endpoint.searchParams.set("toolsets", options.toolsets);
  const client = new Client({ name: "smoke-gateway", version: "0" });

  await check("MCP session initializes over Streamable HTTP", async () => {
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    const server = client.getServerVersion();
    assertTruthy(server, "server info");
    return `${server.name} ${server.version ?? ""}`.trim();
  });

  if (results.at(-1)?.ok !== true) {
    await client.close().catch(() => {});
  } else {
    let toolNames = [];
    await check("tools/list returns the tool catalog", async () => {
      const tools = await client.listTools();
      toolNames = tools.tools.map((tool) => tool.name);
      assertTruthy(toolNames.includes("whoami"), "whoami tool");
      const executorTools = ["inspect", "execute", "screenshot"].filter((name) =>
        toolNames.includes(name),
      );
      return `${toolNames.length} tools${executorTools.length > 0 ? `, executor tools: ${executorTools.join(", ")}` : ", no executor tools"}`;
    });

    if (toolNames.includes("whoami")) {
      await check("whoami returns the authenticated Workspace user", async () => {
        const result = await client.callTool({ name: "whoami", arguments: {} });
        assertEqual(result.isError, undefined, "tool error");
        const output = result.structuredContent;
        assertTruthy(output?.subject?.id, "subject id");
        return `${output.subject.name} (${output.subject.id}) at ${output.origin}`;
      });
    } else {
      skip("whoami", "the tool is not in this toolset");
    }

    const unitId = options["unit-id"];
    const worktreeId = options["worktree-id"];
    if (unitId === undefined || (worktreeId === undefined && options.trunk !== true)) {
      skip("inspect", "pass --unit-id with --worktree-id or --trunk");
      skip("screenshot", "pass --unit-id with --worktree-id or --trunk, and --screenshot");
    } else if (!toolNames.includes("inspect")) {
      skip("inspect", "the tool is not listed (executor unavailable or toolset filtered)");
      skip("screenshot", "the tool is not listed");
    } else {
      const scope = worktreeId === undefined ? { trunk: true } : { worktree: worktreeId };
      await check("inspect reads the Unit through gateway → executor", async () => {
        const result = await client.callTool({
          name: "inspect",
          arguments: { unit: unitId, ...scope, target: options.target },
        });
        assertEqual(result.isError, undefined, "tool error");
        const output = result.structuredContent;
        assertEqual(output?.unitId, unitId, "unitId");
        return `kind ${output.kind}, ${result.content?.length ?? 0} content block(s)`;
      });

      if (options.screenshot !== true) {
        skip("screenshot", "pass --screenshot to render it");
      } else if (!toolNames.includes("screenshot")) {
        skip("screenshot", "the tool is not listed");
      } else {
        await check(
          "screenshot renders the Unit through gateway → executor → renderer",
          async () => {
            let result = await client.callTool({
              name: "screenshot",
              arguments: { unit: unitId, ...scope },
            });
            assertEqual(result.isError, undefined, "tool error");
            let output = result.structuredContent;
            for (let attempt = 0; output?.job_id !== undefined && attempt < 40; attempt += 1) {
              await delay(500);
              result = await client.callTool({
                name: "job_get",
                arguments: { job_id: output.job_id },
              });
              assertEqual(result.isError, undefined, "job_get error");
              output = result.structuredContent;
            }
            assertEqual(output?.job_id, undefined, "job finished");
            const images = output?.images;
            assertTruthy(Array.isArray(images) && images.length > 0, "images");
            const images0 = result.content?.filter((block) => block.type === "image").length ?? 0;
            return `${images.length} image(s), ${images0} inline image block(s)`;
          },
        );
      }
    }

    await client.close().catch(() => {});
  }
}

// --- report --------------------------------------------------------------------------------

const failed = results.filter((entry) => !entry.ok && entry.optional !== true);
const skipped = results.filter((entry) => entry.skipped === true);

process.stdout.write(`\nGateway smoke test against ${origin}\n\n`);
for (const entry of results) {
  const mark = entry.skipped === true ? "-" : entry.ok ? "PASS" : entry.optional ? "WARN" : "FAIL";
  process.stdout.write(`  ${mark.padEnd(4)}  ${entry.name}`);
  if (entry.detail) process.stdout.write(`  (${entry.detail})`);
  process.stdout.write("\n");
}
process.stdout.write(
  `\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped\n`,
);

if (failed.length > 0) {
  process.stdout.write("\nRequired checks failed. See the FAIL lines above.\n");
  process.exit(1);
}
process.stdout.write("\nAll required checks passed.\n");
