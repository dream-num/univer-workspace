import { once } from "node:events";
import { createServer, request, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { WorkspaceContentRuntime } from "@univerjs/univer-workspace-client-core";
import { pino } from "pino";
import { createExecutor } from "../../src/executor/server.js";
import { createRenderer } from "../../src/renderer/server.js";
import type { RenderRuntime } from "../../src/renderer/ops.js";
import { parseExecutorConfig } from "../../src/shared/config-executor.js";
import { parseRendererConfig } from "../../src/shared/config-renderer.js";
import { decodeFrame, encodeFrame, FRAME_CONTENT_TYPE } from "../../src/shared/frame.js";
import { responseHeaderSchema } from "../../src/shared/executor-protocol.js";

export const executorToken = "contract-executor-".repeat(3);
export const rendererToken = "contract-renderer-".repeat(3);
export const logger = pino({ level: "silent" });
export const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text x="1" y="25">Hello 世界</text></svg>';
export const metrics = {
  actualHeight: 20,
  actualWidth: 40,
  firstLineAscent: 15,
  firstLineDescent: 5,
  lineCount: 1,
};
export const grant = () => ({
  kind: "session",
  userId: "contract-user",
  session: "contract-session",
  expiresAt: Date.now() + 600_000,
});

export async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  return `http://127.0.0.1:${address.port}`;
}

export async function closeServer(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

export function rpcHeader(role: "executor" | "renderer", op: string, input: unknown = {}) {
  return {
    v: 1,
    op,
    requestId: "contract",
    deadlineMs: 5_000,
    ...(role === "executor" ? { grant: grant() } : {}),
    input,
  };
}

export async function send(
  base: string,
  token: string,
  op: string,
  options: {
    body?: Uint8Array;
    headers?: Record<string, string>;
    method?: string;
    chunks?: { bytes: Uint8Array; waitMs?: number }[];
  } = {},
) {
  return await new Promise<{ status: number; contentType: string | undefined; bytes: Buffer }>(
    (resolve, reject) => {
      const req = request(
        new URL(`/rpc/v1/${op}`, base),
        {
          method: options.method ?? "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": FRAME_CONTENT_TYPE,
            "x-mcp-rpc-version": "1",
            ...options.headers,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("error", reject);
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              contentType: response.headers["content-type"],
              bytes: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on("error", reject);
      void (async () => {
        if (options.chunks) {
          for (const chunk of options.chunks) {
            if (chunk.waitMs) await delay(chunk.waitMs);
            if (req.destroyed) return;
            req.write(chunk.bytes);
          }
          req.end();
        } else req.end(options.body);
      })().catch(reject);
    },
  );
}

export function envelope(bytes: Uint8Array) {
  return responseHeaderSchema.parse(decodeFrame(bytes).header);
}

export async function fixture(controlRenderer = false) {
  const state = {
    unitType: "slide",
    revision: 7,
    writes: 0,
    reads: 0,
    workspaceCalls: 0,
    measurements: 0,
    hangWorkspace: false,
    hangWrite: false,
    hangMeasure: false,
    rendererVersion: 1,
    rendererOperations: ["screenshot", "printPdf", "lint", "measureText"],
    rendererStatus: 200,
    rendererCapabilityCalls: 0,
    rendererRedirect: false,
    value: "value",
    pngBytes: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
      "base64",
    ),
  };
  const workspace = createServer((req, res) => {
    state.workspaceCalls++;
    if (state.hangWorkspace) return;
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/session") {
      res.end(
        JSON.stringify({
          authenticated: true,
          user: { id: "contract-user", displayName: "Contract" },
        }),
      );
    } else if (req.url === "/api/worktrees/wt") {
      res.end(
        JSON.stringify({
          worktree: {
            id: "wt",
            name: "Contract",
            state: "draft",
            units: [
              {
                unitId: "unit",
                unitType: state.unitType,
                name: "Slide",
                nodeId: "node",
                resourceId: "resource",
                source: "worktree",
                draftHeadRevision: state.revision,
                change: "added",
                mergeResult: "pending",
                activationState: "waitingForMerge",
                target: { spaceId: "space", parentNodeId: null },
              },
            ],
          },
        }),
      );
    } else res.writeHead(404).end();
  });
  const workspaceUrl = await listen(workspace);
  const runtime: WorkspaceContentRuntime = {
    async executeAndCommit(input) {
      state.writes++;
      input.observe?.({ coldStart: false, workerMs: 1 });
      if (state.hangWrite) return await new Promise<never>(() => {});
      state.revision++;
      return { committed: true, revision: state.revision, status: "committed", value: state.value };
    },
    async executeRead(input) {
      state.reads++;
      input.observe?.({ coldStart: false, workerMs: 1 });
      return {
        value: {
          ok: true,
          value: { kind: "presentation", unitId: "unit", name: state.value, slides: [] },
        },
        state: {
          connection: "online",
          baseRevision: state.revision,
          knownHeadRevision: state.revision,
          pendingMutationCount: 0,
          bufferedChangesetCount: 0,
          awaitingChangeset: null,
          conflict: null,
        },
      };
    },
    async exportUnitData() {
      throw new Error("Unexpected runtime export");
    },
    async close() {},
  };
  // Only methods exercised by these contracts are needed from the Chromium runtime.
  const renderRuntime = {
    async close() {},
    async measureText() {
      state.measurements++;
      if (state.hangMeasure) return await new Promise<never>(() => {});
      return metrics;
    },
    async render() {
      return { bytes: state.pngBytes, width: 1, height: 1 };
    },
  } as unknown as RenderRuntime;
  const renderer = createRenderer(parseRendererConfig({ MCP_RENDERER_TOKEN: rendererToken }), {
    createRuntime: async () => renderRuntime,
    logger,
  });
  const rendererUrl = await listen(renderer.server);
  const proxy = createServer((req, res) => {
    if (req.url === "/rpc/v1/capabilities") {
      state.rendererCapabilityCalls++;
      if (req.headers.authorization !== `Bearer ${rendererToken}`) {
        res.writeHead(401).end();
        return;
      }
      if (state.rendererRedirect) {
        res.writeHead(302, { location: `${rendererUrl}/rpc/v1/capabilities` }).end();
        return;
      }
      res
        .writeHead(state.rendererStatus, { "content-type": "application/json" })
        .end(JSON.stringify({ v: state.rendererVersion, operations: state.rendererOperations }));
    } else {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        void fetch(`${rendererUrl}${req.url}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${rendererToken}`,
            "content-type": FRAME_CONTENT_TYPE,
            "x-mcp-rpc-version": "1",
          },
          body: Buffer.concat(chunks),
        })
          .then(async (reply) =>
            res
              .writeHead(reply.status, { "content-type": reply.headers.get("content-type") ?? "" })
              .end(Buffer.from(await reply.arrayBuffer())),
          )
          .catch(() => res.writeHead(500).end());
      });
    }
  });
  const discoveryUrl = controlRenderer ? await listen(proxy) : rendererUrl;
  const executor = createExecutor(
    parseExecutorConfig({
      WORKSPACE_ORIGIN: workspaceUrl,
      MCP_EXECUTOR_TOKEN: executorToken,
      MCP_RENDERER_URL: discoveryUrl,
      MCP_RENDERER_TOKEN: rendererToken,
    }),
    { runtime, logger },
  );
  const executorUrl = await listen(executor.server);
  return {
    state,
    executorUrl,
    rendererUrl,
    async close() {
      executor.server.closeAllConnections();
      renderer.server.closeAllConnections();
      await executor.close();
      await renderer.close();
      await closeServer(workspace);
      if (controlRenderer) await closeServer(proxy);
    },
  };
}

export { encodeFrame, decodeFrame, FRAME_CONTENT_TYPE };
