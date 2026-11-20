import { toolError } from "./tool-error.js";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { opSpecs, PROTOCOL_VERSION } from "../src/shared/executor-protocol.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { decodeFrame, encodeFrame } from "../src/shared/frame.js";
import { zeroCost } from "../src/shared/usage.js";
import { createGateway } from "./gateway.js";
import { listenGateway } from "./listen-gateway.js";
import { testStagingDirectory } from "./staging-directory.js";

const origin = "https://workspace.example";
const node = (id: string, resource: unknown) => ({
  node: {
    id,
    name: id,
    accessRole: "viewer",
    capabilities: { browseChildren: false, createChildren: false, move: false, rename: false, share: false, trash: false },
    hasChildren: false,
    parentNodeId: null,
    resource,
    spaceId: "personal-2",
    updatedAt: "2026-11-14T00:00:00.000Z",
  },
  space: { id: "personal-2", name: "Agent" },
  breadcrumbs: [{ id, name: id }],
  navigationRootNodeId: id,
});
const resourceCapabilities = { downloadContent: false, editContent: false, openContent: true };
const nodes: Record<string, unknown> = {
  drop: node("drop", { id: "r1", kind: "univer", unitId: "unit-of-drop", unitType: "sheet", capabilities: resourceCapabilities }),
  upload: node("upload", { id: "r2", kind: "blob", availability: "ready", byteSize: 3, mediaType: "text/plain", capabilities: { ...resourceCapabilities, downloadContent: true } }),
};
const outputs: Record<string, (unitId: string) => object> = {
  "content.sheet-lens": () => ({ text: "A1 = 1", json: null, revision: 3, warnings: [] }),
  "content.inspect": (unitId) => ({ kind: "workbook", unitId }),
  "render.screenshot": (unitId) => ({ unitId, unitType: "sheet", images: [] }),
};
const reads: [string, Record<string, unknown>][] = [
  ["read", { range: "Sheet1!A1" }],
  ["find", { terms: ["1"] }],
  ["outline", {}],
  ["inspect", { target: "workbook" }],
  ["screenshot", {}],
];

let executor: Server;
let gateway: ReturnType<typeof createGateway>;
let client: Client;
let workspacePaths: string[];
let executorInputs: { op: string; unitId: unknown; scope: unknown }[];

beforeEach(async () => {
  workspacePaths = [];
  executorInputs = [];
  executor = createServer(async (request, response) => {
    if (request.url === "/rpc/v1/capabilities") {
      response.end(JSON.stringify({ v: PROTOCOL_VERSION, operations: Object.keys(opSpecs) }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const op = request.url!.replace("/rpc/v1/", "");
    const { input } = z
      .object({ input: z.object({ unitId: z.string(), scope: z.unknown() }) })
      .parse(decodeFrame(Buffer.concat(chunks)).header);
    executorInputs.push({ op, unitId: input.unitId, scope: input.scope });
    response.setHeader("Content-Type", "application/octet-stream");
    response.end(encodeFrame({ ok: true, output: outputs[op]!(input.unitId), meta: { executor: "none", cost: zeroCost } }));
  });
  executor.listen(0, "127.0.0.1");
  await once(executor, "listening");
  const address = executor.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(new Request(input, init).url).pathname;
    workspacePaths.push(path);
    if (path === "/api/session") {
      return Response.json({ authenticated: true, user: { id: "agent-2", displayName: "agent", kind: "agent", claimed: false } });
    }
    const found = nodes[path.replace("/api/nodes/", "")];
    return found
      ? Response.json(found)
      : Response.json({ error: { code: "NOT_FOUND", message: "The resource was not found." } }, { status: 404 });
  };
  let url: string;
  ({ gateway, url } = await listenGateway((url) =>
    createGateway(
      parseGatewayConfig({
        MCP_DEV_SESSION_PASSTHROUGH: "1",
        WORKSPACE_ORIGIN: origin,
        MCP_STAGING_DIRECTORY: testStagingDirectory(),
        MCP_PUBLIC_URL: url,
        MCP_EXECUTOR_URLS: `http://127.0.0.1:${address.port}`,
        MCP_EXECUTOR_TOKEN: "t".repeat(32),
      }),
      { logger: pino({ level: "silent" }), fetcher },
    ),
  ));
  client = new Client({ name: "unit-link-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: "Bearer test-session-secret" } },
    }),
  );
});

afterEach(async () => {
  await client.close();
  await gateway.close();
  gateway.server.closeAllConnections();
  await new Promise((resolve) => gateway.server.close(resolve));
  await new Promise((resolve) => executor.close(resolve));
});

it.each(reads)("%s reads the trunk Unit a file link names", async (name, args) => {
  const result = await client.callTool({
    name,
    arguments: { ...args, unit: `${origin}/nodes/drop`, trunk: true },
  });
  expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ unitId: "unit-of-drop" });
  expect(executorInputs).toMatchObject([{ unitId: "unit-of-drop", scope: { kind: "trunk" } }]);
  expect(workspacePaths).toContain("/api/nodes/drop");
});

it.each(reads)("%s still takes a Unit ID without a Node lookup", async (name, args) => {
  await client.callTool({ name, arguments: { ...args, unit: "unit-1", trunk: true } });
  expect(executorInputs).toMatchObject([{ unitId: "unit-1" }]);
  expect(workspacePaths.filter((path) => path.startsWith("/api/nodes/"))).toEqual([]);
});

it.each(reads)("%s refuses a link of another Workspace, a non-Unit file and a hidden file", async (name, args) => {
  const call = async (unit: string) =>
    toolError(await client.callTool({ name, arguments: { ...args, unit, trunk: true } }));
  expect(await call("https://elsewhere.example/nodes/drop")).toMatchObject({ code: "workspace-origin-mismatch" });
  expect(workspacePaths.filter((path) => path.startsWith("/api/nodes/"))).toEqual([]);
  expect(await call(`${origin}/nodes/upload`)).toMatchObject({
    code: "workspace-argument-invalid",
    message: 'The link names "upload", which is not a Unit, so this tool cannot read it.',
  });
  expect(await call(`${origin}/nodes/missing`)).toMatchObject({ code: "NOT_FOUND" });
  expect(await call(`${origin}/spaces/personal-2`)).toMatchObject({ code: "workspace-argument-invalid" });
  expect(executorInputs).toEqual([]);
});
