import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const applicationRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path) => await rm(path, { force: true, recursive: true })),
  );
});

describe("Workspace CLI Space/Node built entrypoint", () => {
  it("preserves command requests, output, errors and current Session access", async () => {
    const requests: CapturedRequest[] = [];
    const state = { invalidSpaces: false, name: "Quarterly Plan", parentNodeId: null as string | null };
    const server = createServer((request, response) => {
      void handleRequest(request, response, requests, state);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing HTTP address");
    const origin = `http://127.0.0.1:${address.port}`;
    const directory = await mkdtemp(join(tmpdir(), "workspace-space-cli-"));
    temporaryDirectories.push(directory);
    const env = { ...process.env, UNIVER_HOME: join(directory, "home") };

    try {
      expect(await runCli(["config", "set", "workspace.origin", origin, "--json"], env)).toMatchObject({
        code: 0,
        stderr: "",
      });
      expect(
        await runCli(["login", "--username", "agent", "--password-stdin", "--json"], env, "test-password\n"),
      ).toMatchObject({ code: 0, stderr: "" });

      const listed = await runCli(["space", "list", "--json"], env);
      expect(JSON.parse(listed.stdout)).toEqual({
        spaces: [{ id: "space-1", name: "Personal", type: "personal" }],
      });
      expect(listed).toMatchObject({ code: 0, stderr: "" });

      const browsed = await runCli(["space", "browse", "space-1", "--json"], env);
      expect(JSON.parse(browsed.stdout)).toMatchObject({
        nodes: [{ nodeId: "node-1" }, { nodeId: "node-2" }],
      });
      expect(browsed).toMatchObject({ code: 0, stderr: "" });

      const created = await runCli(
        ["space", "node", "create", "space-1", "--name", "Folder", "--parent", "parent-1", "--json"],
        env,
      );
      expect(JSON.parse(created.stdout)).toMatchObject({
        node: { name: "Folder", nodeId: "created", parentNodeId: "parent-1" },
      });

      const renamed = await runCli(
        ["space", "node", "rename", "node-1", "--name", "Renamed", "--json"],
        env,
      );
      expect(JSON.parse(renamed.stdout)).toMatchObject({ node: { name: "Renamed", nodeId: "node-1" } });

      const moved = await runCli(
        ["space", "node", "move", "node-1", "--parent", "parent-2", "--json"],
        env,
      );
      expect(JSON.parse(moved.stdout)).toMatchObject({ node: { nodeId: "node-1", parentNodeId: "parent-2" } });
      const movedToRoot = await runCli(
        ["space", "node", "move", "node-1", "--root", "--json"],
        env,
      );
      expect(JSON.parse(movedToRoot.stdout)).toMatchObject({ node: { nodeId: "node-1", parentNodeId: null } });

      const trashed = await runCli(["space", "node", "trash", "node-1", "--json"], env);
      expect(JSON.parse(trashed.stdout)).toMatchObject({
        trashBatch: { root: { nodeId: "node-1" }, trashBatchId: "trash-1" },
      });

      state.invalidSpaces = true;
      const failed = await runCli(["space", "list", "--json"], env);
      expect(failed).toMatchObject({ code: 1, stdout: "" });
      expect(failed.stderr).toContain("workspace-invalid-response: Workspace response is missing Spaces");

      expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual(
        expect.arrayContaining([
          "GET /api/spaces",
          "GET /api/spaces/space-1/nodes",
          "GET /api/spaces/space-1/nodes?cursor=next%20page",
          "POST /api/nodes",
          "PATCH /api/nodes/node-1",
          "POST /api/nodes/node-1/trash",
        ]),
      );
      const authenticated = requests.filter(({ path }) =>
        path.startsWith("/api/spaces") || path.startsWith("/api/nodes"),
      );
      expect(authenticated.every(({ cookie }) => cookie === "workspace_session=test")).toBe(true);
      expect(authenticated.every(({ role }) => role === "client")).toBe(true);
      expect(
        authenticated
          .filter(({ method }) => method !== "GET" && method !== "HEAD")
          .every(({ requestOrigin }) => requestOrigin === origin),
      ).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 120_000);
});

interface CapturedRequest {
  readonly body: Record<string, unknown> | undefined;
  readonly cookie: string | undefined;
  readonly method: string;
  readonly path: string;
  readonly requestOrigin: string | undefined;
  readonly role: string | undefined;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: CapturedRequest[],
  state: { invalidSpaces: boolean; name: string; parentNodeId: string | null },
): Promise<void> {
  const body = request.method === "POST" || request.method === "PATCH" ? await readJson(request) : undefined;
  requests.push({
    body,
    cookie: request.headers.cookie,
    method: request.method ?? "GET",
    path: request.url ?? "",
    requestOrigin: request.headers.origin,
    role: typeof request.headers["x-univer-cli-sdk-role"] === "string" ? request.headers["x-univer-cli-sdk-role"] : undefined,
  });
  if (request.method === "POST" && request.url === "/api/auth/password/login") {
    writeJson(
      response,
      200,
      { authenticated: true, user: { displayName: "Agent", id: "user-1" } },
      { "set-cookie": "workspace_session=test; Path=/; HttpOnly" },
    );
    return;
  }
  if (request.headers.cookie !== "workspace_session=test") {
    writeJson(response, 401, { error: { code: "UNAUTHORIZED", message: "missing session" } });
    return;
  }
  if (request.method === "GET" && request.url === "/api/spaces") {
    writeJson(
      response,
      200,
      state.invalidSpaces
        ? { invalid: true }
        : { spaces: [{ id: "space-1", name: "Personal", type: "personal" }] },
    );
    return;
  }
  if (request.method === "GET" && request.url === "/api/spaces/space-1/nodes") {
    writeJson(response, 200, page([node("node-1", "Quarterly Plan")], "next page"));
    return;
  }
  if (request.method === "GET" && request.url === "/api/spaces/space-1/nodes?cursor=next%20page") {
    writeJson(response, 200, page([node("node-2", "Archive")], null));
    return;
  }
  if (request.method === "POST" && request.url === "/api/nodes") {
    writeJson(
      response,
      201,
      node("created", String(body?.["name"]), String(body?.["parentNodeId"])),
    );
    return;
  }
  if (request.method === "PATCH" && request.url === "/api/nodes/node-1") {
    if (typeof body?.["name"] === "string") state.name = body["name"];
    if (Object.hasOwn(body ?? {}, "parentNodeId")) {
      state.parentNodeId = typeof body?.["parentNodeId"] === "string" ? body["parentNodeId"] : null;
    }
    writeJson(response, 200, node("node-1", state.name, state.parentNodeId));
    return;
  }
  if (request.method === "POST" && request.url === "/api/nodes/node-1/trash") {
    writeJson(response, 201, trashBatch("node-1"));
    return;
  }
  writeJson(response, 404, { error: { code: "NOT_FOUND" } });
}

function page(nodes: readonly Record<string, unknown>[], nextCursor: string | null): Record<string, unknown> {
  return {
    breadcrumbs: [],
    navigationRootNodeId: null,
    nextCursor,
    nodes,
    parentNode: null,
    space: { id: "space-1", name: "Personal", type: "personal" },
  };
}

function node(id: string, name: string, parentNodeId: string | null = null): Record<string, unknown> {
  return {
    accessRole: "owner",
    capabilities: {
      browseChildren: true,
      createChildren: true,
      move: true,
      rename: true,
      share: true,
      trash: true,
    },
    hasChildren: false,
    id,
    name,
    parentNodeId,
    resource: null,
    spaceId: "space-1",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}

function trashBatch(nodeId: string): Record<string, unknown> {
  return {
    capabilities: { removePermanently: true, restore: true },
    id: "trash-1",
    nodeCount: 1,
    originalLocation: { breadcrumbs: [{ id: nodeId, name: "Renamed" }] },
    removeBlockedBy: null,
    restoreBlockedBy: null,
    root: { id: nodeId, name: "Renamed", resource: null },
    spaceId: "space-1",
    trashedAt: "2026-08-28T00:00:00.000Z",
    trashedBy: { avatarUrl: null, displayName: "Agent", id: "user-1", username: "agent" },
  };
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let source = "";
  for await (const chunk of request) source += Buffer.from(chunk).toString("utf8");
  if (source === "") return {};
  return JSON.parse(source) as Record<string, unknown>;
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(value));
}

async function runCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input?: string,
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  const child = spawn(process.execPath, [join(applicationRoot, "dist/main.js"), ...args], {
    env,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (input !== undefined) child.stdin?.end(input);
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stderr, stdout }));
  });
}
