#!/usr/bin/env node
// Smoke test for one executor deployed for FC over its internal RPC: the MCP image with
// MCP_ROLE=executor and EXECUTOR_AFFINITY=header (see the MCP README, "Executor on FC").
//
//   node apps/mcp/scripts/smoke-executor-fc.mjs --token "$MCP_EXECUTOR_TOKEN"
//
// Checks, in order: process and auth surfaces, frame and limit rejections, then an optional
// Workspace round trip when a real Workspace session is supplied:
//
//   node apps/mcp/scripts/smoke-executor-fc.mjs --token ... \
//     --workspace https://workspace.univer.plus --session "<workspace_session cookie>"
//
// Add --worktree-id and --unit-id to also read one real Unit through the headless runtime.
// Exit codes: 0 everything required passed, 1 a required check failed, 2 the executor is unreachable.

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const FRAME_CONTENT_TYPE = "application/vnd.univer.mcp-frame+v1";
const PROTOCOL_VERSION = 1;
const REQUEST_TIMEOUT_MS = 10_000;

const { values: options } = parseArgs({
  allowPositionals: false,
  options: {
    url: { type: "string", default: process.env["MCP_EXECUTOR_URL"] ?? "http://127.0.0.1:9000" },
    token: { type: "string", default: process.env["MCP_EXECUTOR_TOKEN"] },
    workspace: { type: "string", default: process.env["WORKSPACE_ORIGIN"] },
    session: { type: "string", default: process.env["WORKSPACE_SESSION"] },
    "user-id": { type: "string", default: process.env["WORKSPACE_USER_ID"] },
    "worktree-id": { type: "string" },
    "unit-id": { type: "string" },
    "unit-type": { type: "string" },
    target: { type: "string" },
    "renderer-url": { type: "string", default: process.env["MCP_RENDERER_URL"] },
    "renderer-token": { type: "string", default: process.env["MCP_RENDERER_TOKEN"] },
    "skip-render": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (options.help) {
  process.stdout.write(
    [
      "Usage: node apps/mcp/scripts/smoke-executor-fc.mjs [options]",
      "",
      "  --url <origin>          FC executor origin (default http://127.0.0.1:9000)",
      "  --token <token>         MCP_EXECUTOR_TOKEN (default: the environment variable)",
      "  --workspace <origin>    Workspace origin, for the optional round trip",
      "  --session <cookie>      workspace_session cookie value, enables the round trip",
      "  --user-id <id>          Workspace user ID (otherwise read from /api/session)",
      "  --worktree-id <id>      with --unit-id, also runs the Unit operations",
      "  --unit-id <id>          Unit inside --worktree-id",
      "  --unit-type <type>      sheet, doc, slide, board or base; inferred from inspect otherwise",
      "  --target <name>         inspect target; defaults from the Unit type",
      "  --renderer-url <origin> check the renderer's capabilities directly",
      "  --renderer-token <tok>  renderer bearer (default: the environment variable)",
      "  --skip-render           skip the render operations even when advertised",
      "",
      "The token must be at least 32 characters: the executor refuses to start otherwise.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

if (options.token === undefined || options.token.length < 32) {
  process.stderr.write(
    "A token of at least 32 characters is required: pass --token or set MCP_EXECUTOR_TOKEN.\n",
  );
  process.exit(2);
}

const origin = options.url.replace(/\/+$/u, "");
const token = options.token;

const results = [];
let capabilities = [];

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

function assertEqual(actual, expected, label) {
  if (actual !== expected)
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value, got ${JSON.stringify(value)}`);
}

// --- framing -------------------------------------------------------------------------------

function encodeFrame(header, payload) {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  return Buffer.concat([length, json, payload ?? Buffer.alloc(0)]);
}

function decodeFrame(bytes) {
  if (bytes.length < 4) throw new Error("response is shorter than a frame header");
  const length = bytes.readUInt32BE(0);
  if (length === 0 || length > bytes.length - 4)
    throw new Error("response frame header is invalid");
  const header = JSON.parse(bytes.subarray(4, 4 + length).toString("utf8"));
  return { header, payload: bytes.subarray(4 + length) };
}

function jsonBody(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return undefined;
  }
}

async function raw(
  path,
  { method = "POST", headers = {}, body, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
  const response = await fetch(new URL(path, origin), {
    method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const bytes = Buffer.from(new Uint8Array(await response.arrayBuffer()));
  return { status: response.status, contentType: response.headers.get("content-type"), bytes };
}

function rpcHeaders(overrides = {}) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": FRAME_CONTENT_TYPE,
    "x-mcp-rpc-version": String(PROTOCOL_VERSION),
    ...overrides,
  };
}

/** One RPC call. Resolves with the HTTP status plus either a decoded frame or the error body. */
async function rpc(
  op,
  { input = {}, grant, headers = {}, payload, deadlineMs = 5_000, timeoutMs = 30_000 } = {},
) {
  const header = {
    v: PROTOCOL_VERSION,
    op,
    requestId: `smoke-${randomUUID()}`,
    deadlineMs,
    grant,
    input,
  };
  const response = await raw(`/rpc/v1/${op}`, {
    headers: rpcHeaders(headers),
    body: encodeFrame(header, payload),
    timeoutMs,
  });
  if (response.status !== 200) return { status: response.status, error: jsonBody(response.bytes) };
  const frame = decodeFrame(response.bytes);
  if (
    frame.payload.length !== 0 &&
    !["markdown.export", "render.screenshot", "render.printPdf"].includes(op)
  )
    throw new Error(`${op}: unexpected response payload of ${frame.payload.length} bytes`);
  return { status: 200, frame, bytes: response.bytes, payload: frame.payload };
}

function expiredGrant() {
  return {
    kind: "session",
    userId: "smoke-user",
    session: "smoke-session-not-valid-anywhere",
    expiresAt: Date.now() - 1_000,
  };
}

// --- checks --------------------------------------------------------------------------------

let reachable = false;
await check("executor answers /healthz", async () => {
  const response = await raw("/healthz", { method: "GET", timeoutMs: 5_000 });
  assertEqual(response.status, 200, "status");
  assertEqual(response.bytes.toString("utf8"), "ok", "body");
  reachable = true;
});

if (!reachable) {
  process.stderr.write(
    [
      `Cannot reach ${origin}. The container is not listening or the port mapping is wrong.`,
      "Check that the container sets MCP_ROLE=executor, HOST=0.0.0.0 and PORT (FC uses 9000), and",
      "that -p maps that port.",
      "Then look at `docker logs <container>`.",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

await check("/healthz stays open without a bearer", async () => {
  const response = await raw("/healthz", { method: "GET" });
  assertEqual(response.status, 200, "status");
});

await check("rejects a missing bearer with 401", async () => {
  const response = await raw("/rpc/v1/content.inspect", {
    headers: { "content-type": FRAME_CONTENT_TYPE, "x-mcp-rpc-version": "1" },
    body: encodeFrame({}),
  });
  assertEqual(response.status, 401, "status");
  assertEqual(
    jsonBody(response.bytes)?.error?.code,
    "workspace-executor-unauthorized",
    "error code",
  );
});

await check("keeps /metrics behind the bearer", async () => {
  const response = await raw("/metrics", { method: "GET" });
  assertEqual(response.status, 401, "status");
});

await check("serves /metrics to the bearer", async () => {
  const response = await raw("/metrics", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
  assertEqual(response.status, 200, "status");
  const text = response.bytes.toString("utf8");
  assertTruthy(text.includes("mcp_executor_reruns_total"), "executor metric");
});

await check("advertises version 1 and the executor operation catalog", async () => {
  const response = await raw("/rpc/v1/capabilities", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
  assertEqual(response.status, 200, "status");
  const body = jsonBody(response.bytes);
  assertEqual(body?.v, PROTOCOL_VERSION, "capabilities v");
  assertTruthy(Array.isArray(body?.operations), "operations");
  for (const op of ["content.inspect", "content.execute", "exchange.import", "diagnostics.probe"])
    assertTruthy(body.operations.includes(op), `operation ${op}`);
  capabilities = body.operations;
  return `${body.operations.length} operations`;
});

await check("advertises header affinity so gateways send x-executor-key", async () => {
  const response = await raw("/rpc/v1/capabilities", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
  assertEqual(
    jsonBody(response.bytes)?.affinity,
    "header",
    "affinity (set EXECUTOR_AFFINITY=header)",
  );
});

const renderOperations = ["render.screenshot", "render.printPdf", "render.lint"];
const advertisedRender = renderOperations.filter((op) => capabilities.includes(op));
if (advertisedRender.length === renderOperations.length)
  results.push({
    name: "renderer discovery advertises all three render operations",
    ok: true,
    detail: advertisedRender.join(", "),
  });
else if (advertisedRender.length === 0)
  results.push({
    name: "renderer discovery",
    ok: true,
    optional: true,
    skipped: true,
    detail: "no renderer configured: render operations hidden",
  });
else
  results.push({
    name: "renderer discovery",
    ok: false,
    detail: `partial: ${advertisedRender.join(", ")} (renderer down or protocol version mismatch?)`,
  });

await check("rejects an unknown operation with 404", async () => {
  const response = await raw("/rpc/v1/not.an.operation", {
    headers: rpcHeaders(),
    body: encodeFrame({}),
  });
  assertEqual(response.status, 404, "status");
  assertEqual(
    jsonBody(response.bytes)?.error?.code,
    "workspace-executor-operation-unknown",
    "code",
  );
});

await check("rejects the wrong content type with 415", async () => {
  const response = await raw("/rpc/v1/content.inspect", {
    headers: rpcHeaders({ "content-type": "text/plain" }),
    body: Buffer.from("{}"),
  });
  assertEqual(response.status, 415, "status");
  assertEqual(jsonBody(response.bytes)?.error?.code, "workspace-executor-frame-invalid", "code");
});

await check("rejects a foreign protocol version with 426", async () => {
  const response = await raw("/rpc/v1/content.inspect", {
    headers: rpcHeaders({ "x-mcp-rpc-version": "2" }),
    body: encodeFrame({}),
  });
  assertEqual(response.status, 426, "status");
  assertEqual(jsonBody(response.bytes)?.error?.code, "workspace-executor-version-mismatch", "code");
});

await check("rejects a garbage frame with 400", async () => {
  const response = await raw("/rpc/v1/content.inspect", {
    headers: rpcHeaders(),
    body: Buffer.from([0, 0, 0, 0]),
  });
  assertEqual(response.status, 400, "status");
  assertEqual(jsonBody(response.bytes)?.error?.code, "workspace-executor-frame-invalid", "code");
});

await check("rejects a frame whose op differs from the path with 400", async () => {
  const header = {
    v: PROTOCOL_VERSION,
    op: "content.execute",
    requestId: `smoke-${randomUUID()}`,
    deadlineMs: 5_000,
    grant: expiredGrant(),
    input: {},
  };
  const response = await raw("/rpc/v1/content.inspect", {
    headers: rpcHeaders(),
    body: encodeFrame(header),
  });
  assertEqual(response.status, 400, "status");
  assertEqual(jsonBody(response.bytes)?.error?.code, "workspace-executor-frame-invalid", "code");
});

await check("rejects a deadline above the operation budget with 400", async () => {
  const header = {
    v: PROTOCOL_VERSION,
    op: "content.inspect",
    requestId: `smoke-${randomUUID()}`,
    deadlineMs: 60_000,
    grant: expiredGrant(),
    input: { scope: { kind: "trunk" }, unitId: "unit", target: "workbook" },
  };
  const response = await raw("/rpc/v1/content.inspect", {
    headers: rpcHeaders(),
    body: encodeFrame(header),
  });
  assertEqual(response.status, 400, "status");
});

await check("rejects a body above the operation limit with 413", async () => {
  const response = await raw("/rpc/v1/content.inspect", {
    headers: rpcHeaders(),
    body: Buffer.alloc(300 * 1024, 0x20),
  });
  assertEqual(response.status, 413, "status");
  assertEqual(jsonBody(response.bytes)?.error?.code, "workspace-request-too-large", "code");
});

await check("returns an application frame error for an expired grant", async () => {
  const response = await rpc("content.inspect", {
    grant: expiredGrant(),
    input: { scope: { kind: "trunk" }, unitId: "unit", target: "workbook" },
  });
  assertEqual(response.status, 200, "status");
  const header = response.frame?.header;
  assertEqual(header?.ok, false, "frame ok");
  assertEqual(header?.error?.code, "workspace-authentication-required", "error code");
  assertEqual(header?.error?.outcome, "auth_error", "error outcome");
});

await check("accepts the x-executor-key affinity header", async () => {
  const key = `k${"0".repeat(32)}`;
  const withHeader = await rpc("content.inspect", {
    grant: expiredGrant(),
    headers: { "x-executor-key": key },
    input: { scope: { kind: "trunk" }, unitId: "unit", target: "workbook" },
  });
  assertEqual(withHeader.status, 200, "status");
  assertEqual(withHeader.frame?.header?.error?.code, "workspace-authentication-required", "code");
  return "an unknown/newer header does not change routing";
});

await check(
  "executor reaches Workspace (a bogus session fails as unauthenticated, not as a network error)",
  async () => {
    const response = await rpc("diagnostics.probe", {
      grant: {
        kind: "session",
        userId: "smoke-user",
        session: "smoke-session-not-valid-anywhere",
        expiresAt: Date.now() + 60_000,
      },
      deadlineMs: 10_000,
    });
    const header = response.frame?.header;
    assertEqual(response.status, 200, "status");
    assertEqual(header?.ok, false, "frame ok");
    assertEqual(header?.error?.code, "workspace-authentication-required", "error code");
    return `Workspace answered and rejected the fake session (${header.error.detail?.cause?.code ?? "auth"})`;
  },
  { optional: true },
);

// --- Unit and render operations ------------------------------------------------------------

const session = options.session;
const workspace = options.workspace?.replace(/\/+$/u, "");
const unitId = options["unit-id"];
const worktreeId = options["worktree-id"];
const rendererUrl = options["renderer-url"]?.replace(/\/+$/u, "");
const rendererToken = options["renderer-token"];
const renderEnabled =
  !options["skip-render"] && advertisedRender.length === renderOperations.length;
const UNIT_TYPES = ["sheet", "doc", "slide", "board", "base"];
if (options["unit-type"] !== undefined && !UNIT_TYPES.includes(options["unit-type"])) {
  process.stderr.write(`--unit-type must be one of ${UNIT_TYPES.join(", ")}\n`);
  process.exit(2);
}
let userId = options["user-id"];
let unitType = options["unit-type"];

function skip(name, detail) {
  results.push({ name, ok: true, optional: true, skipped: true, detail });
}

function defaultTarget(type) {
  return (
    { sheet: "workbook", doc: "document", slide: "presentation", base: "base", board: "board" }[
      type
    ] ?? "workbook"
  );
}

function unitTypeForKind(kind) {
  if (kind === "workbook" || kind === "worksheet" || kind === "worksheet-range") return "sheet";
  if (kind === "document" || kind === "paragraph") return "doc";
  if (kind === "presentation" || kind === "slide") return "slide";
  if (kind === "base") return "base";
  if (kind === "board" || kind === "board-element") return "board";
  return undefined;
}

function isPng(bytes) {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function liveGrant() {
  return { kind: "session", userId, session, expiresAt: Date.now() + 5 * 60_000 };
}

/** Unwraps a successful frame or throws the frame error, which carries the actionable message. */
function outputOf(response, label) {
  assertEqual(response.status, 200, "status");
  const header = response.frame?.header;
  assertEqual(header?.ok, true, `${label}: ${JSON.stringify(header?.error ?? "no frame body")}`);
  return header;
}

if (rendererUrl !== undefined && rendererToken !== undefined) {
  await check("renderer answers capabilities directly", async () => {
    const response = await fetch(new URL("/rpc/v1/capabilities", rendererUrl), {
      headers: { authorization: `Bearer ${rendererToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    assertEqual(response.status, 200, "status");
    const body = await response.json().catch(() => undefined);
    assertEqual(body?.v, PROTOCOL_VERSION, "renderer protocol version");
    for (const op of ["screenshot", "printPdf", "lint", "measureText"])
      assertTruthy(body?.operations?.includes(op), `renderer operation ${op}`);
    return `${new URL(rendererUrl).host}: ${body.operations.length} operations`;
  });
} else {
  skip("renderer answers capabilities directly", "pass --renderer-url and --renderer-token");
}

if (session === undefined) {
  for (const name of [
    "/api/session",
    "diagnostics.probe",
    "content.inspect",
    "content.sheet-lens outline",
    "render.screenshot",
    "render.printPdf",
    "render.lint",
  ])
    skip(name, "pass --session with a Workspace session cookie");
} else if (workspace !== undefined) {
  await check(
    "Workspace accepts the session (/api/session)",
    async () => {
      const response = await fetch(new URL("/api/session", workspace), {
        headers: { cookie: `workspace_session=${session}` },
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => undefined);
      assertEqual(response.status, 200, "status");
      assertEqual(body?.authenticated, true, "authenticated");
      userId ??= body?.user?.id;
      assertTruthy(userId, "user id");
      return `user ${userId} (executorAccess: ${body?.executorAccess === true})`;
    },
    { optional: true },
  );
} else if (userId === undefined) {
  results.push({
    name: "Workspace session",
    ok: false,
    detail:
      "--session needs --workspace (to resolve the user through /api/session) or --user-id; " +
      "the executor resolves Workspace itself, so --user-id is enough behind private DNS",
  });
}

if (session === undefined) {
  // Already recorded as skipped above.
} else if (userId === undefined) {
  skip("diagnostics.probe", "no user ID: pass --workspace or --user-id");
} else {
  await check(
    "diagnostics.probe reaches whoami, the session ticket and the collaboration endpoint",
    async () => {
      const response = await rpc("diagnostics.probe", { grant: liveGrant(), deadlineMs: 10_000 });
      const header = outputOf(response, "diagnostics.probe");
      const output = header.output;
      assertEqual(output.whoami?.id, userId, "whoami id");
      assertEqual(output.ticket, true, "session ticket");
      assertEqual(output.websocket, true, "collaboration websocket");
      return `transport ${output.transport}`;
    },
  );

  if (unitId === undefined || worktreeId === undefined) {
    for (const name of [
      "content.inspect",
      "content.sheet-lens outline",
      "render.screenshot",
      "render.printPdf",
      "render.lint",
    ])
      skip(name, "pass --worktree-id and --unit-id");
  } else {
    const scope = { kind: "worktree", worktreeId };

    await check("content.inspect reads the Unit through the headless runtime", async () => {
      const response = await rpc("content.inspect", {
        grant: liveGrant(),
        input: { scope, unitId, target: options.target ?? defaultTarget(unitType) },
        deadlineMs: 20_000,
      });
      const header = outputOf(response, "content.inspect");
      assertEqual(header.output.unitId, unitId, "unitId");
      unitType ??= unitTypeForKind(header.output.kind);
      return `kind ${header.output.kind}${unitType ? `, type ${unitType}` : ""}, executor ${header.meta?.executor ?? "unknown"}`;
    });

    if (unitType !== undefined && unitType !== "sheet")
      skip("content.sheet-lens outline", `Unit type is ${unitType}`);
    else
      await check("content.sheet-lens outline reads the workbook map", async () => {
        const response = await rpc("content.sheet-lens", {
          grant: liveGrant(),
          input: { scope, unitId, request: { op: "outline" } },
          deadlineMs: 20_000,
        });
        const header = outputOf(response, "content.sheet-lens");
        const output = header.output;
        assertTruthy(typeof output.text === "string" && output.text.length > 0, "outline text");
        assertTruthy(Array.isArray(output.warnings), "warnings");
        assertTruthy(Number.isInteger(output.revision) && output.revision >= 0, "revision");
        return `${output.text.length} characters, revision ${output.revision}`;
      });

    if (!renderEnabled)
      skip(
        "render.screenshot",
        options["skip-render"] ? "skipped by --skip-render" : "renderer not advertised",
      );
    else
      await check("render.screenshot returns PNG bytes", async () => {
        const response = await rpc("render.screenshot", {
          grant: liveGrant(),
          input: { scope, unitId, options: {} },
          deadlineMs: 120_000,
          timeoutMs: 180_000,
        });
        const header = outputOf(response, "render.screenshot");
        const output = header.output;
        assertEqual(output.unitId, unitId, "unitId");
        assertTruthy(Array.isArray(output.images) && output.images.length > 0, "images");
        const payload = response.payload ?? Buffer.alloc(0);
        assertTruthy(isPng(payload), "PNG signature");
        for (const image of output.images) {
          assertEqual(image.mediaType, "image/png", "mediaType");
          assertTruthy(
            image.offset + image.size <= payload.length,
            `image ${image.name} lies inside the payload`,
          );
        }
        const pages = header.meta?.cost?.render_pages ?? 0;
        assertTruthy(pages >= 1, "render_pages");
        return `${output.images.length} image(s), ${payload.length} bytes, ${pages} page(s)`;
      });

    if (!renderEnabled)
      skip(
        "render.printPdf",
        options["skip-render"] ? "skipped by --skip-render" : "renderer not advertised",
      );
    else if (unitType === "base") skip("render.printPdf", "Base Units do not support PDF printing");
    else
      await check("render.printPdf returns a PDF", async () => {
        const response = await rpc("render.printPdf", {
          grant: liveGrant(),
          input: { scope, unitId },
          deadlineMs: 120_000,
          timeoutMs: 180_000,
        });
        const header = outputOf(response, "render.printPdf");
        const output = header.output;
        assertEqual(output.mediaType, "application/pdf", "mediaType");
        assertTruthy(output.pageCount >= 1, "pageCount");
        const payload = response.payload ?? Buffer.alloc(0);
        assertEqual(payload.subarray(0, 5).toString("latin1"), "%PDF-", "PDF header");
        return `${output.pageCount} page(s), ${payload.length} bytes`;
      });

    if (!renderEnabled)
      skip(
        "render.lint",
        options["skip-render"] ? "skipped by --skip-render" : "renderer not advertised",
      );
    else if (unitType !== "slide")
      skip("render.lint", `Unit type is ${unitType ?? "unknown"}, lint is Slide-only`);
    else
      await check("render.lint returns the Slide layout report", async () => {
        const response = await rpc("render.lint", {
          grant: liveGrant(),
          input: { worktreeId, unitId },
          deadlineMs: 60_000,
          timeoutMs: 120_000,
        });
        const header = outputOf(response, "render.lint");
        const output = header.output;
        assertEqual(output.kind, "unit-layout-lint", "kind");
        assertEqual(output.unitType, "slide", "unitType");
        assertTruthy(Array.isArray(output.coverage?.pages), "coverage pages");
        assertTruthy(Array.isArray(output.findings), "findings");
        return `${output.coverage.pages.length} page(s), ${output.findings.length} finding(s)`;
      });
  }
}

// --- report --------------------------------------------------------------------------------

const failed = results.filter((entry) => !entry.ok && entry.optional !== true);
const skipped = results.filter((entry) => entry.skipped === true);

process.stdout.write(`\nExecutor smoke test against ${origin}\n\n`);
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
