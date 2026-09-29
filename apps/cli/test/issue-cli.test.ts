import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
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

const user = { avatarUrl: null, displayName: "Agent", id: "u1", username: "agent" };
const issue = (state: "open" | "closed") => ({
  assignees: [], author: user, body: "", capabilities: { close: true, comment: true, edit: true, triage: true },
  closedAt: state === "closed" ? "2026-09-29T00:00:00.000Z" : null, closedBy: state === "closed" ? user : null,
  commentCount: 0, createdAt: "2026-09-29T00:00:00.000Z", id: "i3", labels: [], number: 3,
  referenceCount: 0, references: [], space: { id: "s1", name: "Team" }, state,
  stateReason: state === "closed" ? "not_planned" : null, title: "Third", updatedAt: "2026-09-29T00:00:00.000Z",
});

describe("Workspace CLI Issue commands", () => {
  it("maps CLI spellings onto the Issue API through the built entrypoint", async () => {
    const requests: { readonly body: unknown; readonly method: string; readonly path: string }[] = [];
    const server = createServer((request, response) => {
      void (async () => {
        const text = await readBody(request);
        const path = request.url ?? "";
        const respond = (status: number, value: unknown, headers: Record<string, string> = {}) => {
          response.writeHead(status, { "content-type": "application/json", ...headers });
          response.end(JSON.stringify(value));
        };
        if (path === "/api/auth/password/login") {
          respond(200, { authenticated: true, user: { displayName: "Agent", id: "u1" } }, {
            "set-cookie": "workspace_session=test; Path=/; HttpOnly",
          });
          return;
        }
        requests.push({ body: text ? JSON.parse(text) : undefined, method: request.method ?? "GET", path });
        if (path.endsWith("/comments")) {
          respond(201, { author: user, body: "closing note\n", createdAt: "2026-09-29T00:00:00.000Z", id: "c1", updatedAt: "2026-09-29T00:00:00.000Z" });
        } else if (path.startsWith("/api/spaces/s1/issues?")) {
          respond(200, { counts: { closed: 0, open: 0 }, items: [], nextCursor: null });
        } else {
          respond(200, issue(request.method === "PATCH" ? "closed" : "open"));
        }
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing HTTP address");
    const directory = await mkdtemp(join(tmpdir(), "workspace-issue-cli-"));
    temporaryDirectories.push(directory);
    const env = { ...process.env, UNIVER_HOME: join(directory, "home") };
    try {
      await runCli(["config", "set", "workspace.origin", `http://127.0.0.1:${address.port}`, "--json"], env);
      await runCli(["login", "--username", "agent", "--password-stdin", "--json"], env, "pw\n");

      const closed = await runCli(
        ["issue", "close", "#3", "--space", "s1", "--reason", "not-planned", "--comment-file", "-", "--json"],
        env,
        "closing note\n",
      );
      expect(closed).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(closed.stdout)).toMatchObject({ issue: { number: 3, state: "closed", stateReason: "not_planned" } });

      await runCli(["issue", "list", "--space", "s1", "--label", "bug", "--label", "docs", "--assignee", "me", "--json"], env);
      const rejected = await runCli(["issue", "get", "abc", "--space", "s1"], env);

      expect(requests).toEqual([
        { body: { body: "closing note\n" }, method: "POST", path: "/api/spaces/s1/issues/3/comments" },
        { body: { state: "closed", stateReason: "not_planned" }, method: "PATCH", path: "/api/spaces/s1/issues/3" },
        { body: undefined, method: "GET", path: "/api/spaces/s1/issues?state=open&label=bug&label=docs&assignee=me" },
      ]);
      expect(rejected.code).not.toBe(0);
      expect(rejected.stderr).toContain("workspace-argument-invalid");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  }, 120_000);
});

async function readBody(request: IncomingMessage): Promise<string> {
  let source = "";
  for await (const chunk of request) source += Buffer.from(chunk).toString("utf8");
  return source;
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
