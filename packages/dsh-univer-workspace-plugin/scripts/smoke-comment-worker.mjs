import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { CombCmd, CmdRspCode } from "@univerjs/protocol";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "dsh-comment-worker-"));
const originalFetch = globalThis.fetch;
const server = createServer();
const sockets = new WebSocketServer({ server });
sockets.on("connection", (socket) =>
  socket.on("message", (bytes) => {
    const message = JSON.parse(bytes.toString());
    if (message.cmd === CombCmd.HELLO)
      socket.send(
        JSON.stringify({
          cmd: message.cmd,
          code: CmdRspCode.OK,
          infoRsp: { memberID: "probe" },
          routeKey: "",
        }),
      );
    else if (message.cmd === CombCmd.JOIN)
      socket.send(
        JSON.stringify({
          cmd: message.cmd,
          code: CmdRspCode.OK,
          joinRsp: { roomInfos: {} },
          routeKey: message.routeKey,
        }),
      );
    else if (message.cmd === CombCmd.HEARTBEAT)
      socket.send(JSON.stringify({ cmd: message.cmd, code: CmdRspCode.OK, routeKey: "" }));
  }),
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  await cp(join(root, "lib/worker.js"), join(temporary, "worker.js"));
  await writeFile(join(temporary, "package.json"), '{"type":"module"}');
  const wrapper = createRequire(require.resolve("@univerjs-pro/engine-formula-rust"));
  const entry = wrapper.resolve("@univerjs-pro/engine-formula-rust-binding");
  const binding = dirname(entry);
  const manifest = JSON.parse(await readFile(join(binding, "package.json"), "utf8"));
  const copyPackage = async (name, source) => {
    const target = join(temporary, "node_modules", name);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
  };
  await copyPackage(manifest.name, binding);
  const nativeRequire = createRequire(entry);
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
    try {
      await copyPackage(name, dirname(nativeRequire.resolve(name)));
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  const worker = (await import(pathToFileURL(join(temporary, "worker.js")).href)).default;
  for (const [type, kind] of [
    [2, "sheet"],
    [1, "doc"],
    [3, "slide"],
    [5, "base"],
    [6, "board"],
  ]) {
    const fixtureFile = join(temporary, `${kind}.json`);
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(root, "test/fixtures/comment-runtime-check.ts"),
        String(type),
        "repaired",
      ],
      {
        cwd: root,
        env: { ...process.env, UNIVER_COMMENT_SNAPSHOT_OUT: fixtureFile },
        timeout: 20000,
      },
    );
    const fixture = JSON.parse(await readFile(fixtureFile, "utf8"));
    globalThis.fetch = async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/rev/0"))
        return Response.json({
          snapshot: fixture.snapshot,
          changesets: fixture.changesets,
          error: null,
        });
      if (url.pathname.endsWith("/fetchmissing"))
        return Response.json({
          changesets: Number(url.searchParams.get("from")) < 2 ? fixture.changesets : [],
          latestRevision: 2,
          error: null,
        });
      if (url.pathname.includes("/block/"))
        return Response.json({
          block: fixture.blocks.find(
            (block) => block.id === decodeURIComponent(url.pathname.split("/block/")[1]),
          ),
          error: null,
        });
      if (url.pathname.endsWith("session-ticket")) return Response.json({ ticket: "probe" });
      throw new Error(`Unexpected packaged worker request: ${url}`);
    };
    const runtime = await worker.createRuntime({
      origin,
      revision: 2,
      scope: { kind: "worktree", worktreeId: "probe" },
      unitId: fixture.id,
      unitType: kind,
      sessionToken: "probe",
      license: "",
    });
    try {
      const data = await runtime.exportUnitData();
      assert.ok(JSON.stringify(data.resources).includes("anchor-1"), kind);
      assert.ok(JSON.stringify(data.resources).includes("replayed-anchor"), kind);
    } finally {
      await runtime.close();
    }
    console.log(`[packaged-comment-worker] ${kind} restore, replay and export passed`);
  }
} finally {
  globalThis.fetch = originalFetch;
  for (const socket of sockets.clients) socket.terminate();
  await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
