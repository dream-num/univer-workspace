import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createNetServer } from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { transformSlideDataToSnapshot, transformWorkbookDataToSnapshot } from "@univerjs-pro/collaboration";
import { CmdRspCode, CombCmd, ErrorCode } from "@univerjs/protocol";

const commandTimeoutMs = 120_000;
const startupTimeoutMs = 30_000;
const shutdownTimeoutMs = 10_000;
const reapTimeoutMs = 2_000;
const timedOut = Symbol("timed-out");
const discoveryTlsKey = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCe6upe/O/WVFn9
5uCTiyHnGKLljpmobC7mAPyasBpzoDBgrJjHa9YxIDeiSGXlcs6N7jDVUlUTQv6L
d//q02RPTsNfDTVzBZ3g9Bw04KL0Dn+hZ+HNHzu18ATdmrrciOYXfuzcgMOZx7S2
hIWzm8CWtu2EhQjbUf3+y+JkShiDA0xkAdMHjlSu9nOSG525y2Fu2x6nPzBLcoH7
3weyrtojW4UEkHBHb7LSFGr6vnqhkI7vVbT+0gNB/luDr8ATp2Ogyv4+Fcl0e5Bk
u2hd0o0xfCmmXclVH5prUdmg+ueGnjUMIYq9rSws2jTNiL9ZhLYmTkneXuhn7gzE
P+xRUwqFAgMBAAECggEAALObd/KN7IL60rrONa3g5xrzZ9K1WEpXT/9Oc4W2LYSA
3NcQ5ZsoRZdAJ6CXh+fLLv06N0w3Fpquclcung7I2+txGV5UOhRwRKn55ecypk6E
vxBXrYbRxf/amvqFO1avYrMrazMg/0YjxMUuV0NSGlg8ZuAKJfhlXVabwphBJh2V
KZYUYptet7i8t8Ngjmk61fXnUYmFyo65xaM8kt9OTUEDttk+gaMPAv3jcexeTtmH
LLq1zSgmVV/BWzjAmSRyHl6y71hVvblD+spHHHcapMnMLZERW/6TOaRagbiemKWo
9butza0UVWCC3QzCNWgNZoR6YVJo9397+SCwN1pREQKBgQDUF9CDPnr6xPC6aseL
CyaFkmUh3HlWyqRMcTXiTGCi7a3abPQdPicWDMfY2gv3XrLR4U+341VpdajqTYfD
Wfd8KZBYArn7T1tWZYnQo0Agc3sUZQ2IYJt+sXWd+T/6VKgWsBNKCuMso92g/YA1
WBIFNPEvhkXjcv8R+IgclOa3VwKBgQC/0P4E2vzxuPTRfC84B+b/+B68Zu6N7g/7
aepvCTbDGfhP3+fOt61+pKZu5w5TlZeF+Ezkc2tbGrTxht8A8pHinW/DGJzoow40
DIhjwN63KPf4UxY3wdiPJZZ/bFZegfSyXKuQ5oFvy3vGVtsvnFnK+3+zS5nxkp4L
8z5KZA/vgwKBgQChXKD6SV39TjqsSbMZOVmMhC3HTltOyguoUPWi/2MCcnwz03MC
kJfiMcUWWgaCpJy+C4LAMAh6nNbvtB7XZKpi36h/HUvsRJsEJ2prvth6GAILKTrb
iEylXlRS5SBkz2W3JSz3x0LBYsaqxlN1wlSre3UIKEsh2grv3DuKK0tBLwKBgCYY
g9rDA2meqkDQwTAHocFErhYM+2QE2/e62WykD9Q/3ClA9vD/Wd3FJajxCs9e7nEV
F3Bn2/KEI1u0xaWSh5bSXdgJk2BAwhlkQ9JMA++sm1MebVM1lKUZegJkqeKrPMYP
0aM9pIdninWh2nZiPxMpT/t0EGcCD5GgBccQiHmxAoGAU2bHDJVoZ7ad3QBUoM/y
yK10lbhZZl1K5X8TuWlklQvOiaxplFHQ/YgI0AMyXXieKbY/kAPwDZQsYIu8NfSP
ebrq7I1qTWHOTHjkSb+qOKciaJUZmXM5dsBLA4jMvr+D5CSj2i7odCJch9CxjXdC
6mmExskl+7eK4eKR2gnAkdo=
-----END PRIVATE KEY-----`;
const discoveryTlsCertificate = `-----BEGIN CERTIFICATE-----
MIIDGjCCAgKgAwIBAgIUbFnDqZ5o+/jWunMdikw5ItcY8gwwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDgyOTEwMDIwMVoXDTM2MDgy
NjEwMDIwMVowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAnurqXvzv1lRZ/ebgk4sh5xii5Y6ZqGwu5gD8mrAac6Aw
YKyYx2vWMSA3okhl5XLOje4w1VJVE0L+i3f/6tNkT07DXw01cwWd4PQcNOCi9A5/
oWfhzR87tfAE3Zq63IjmF37s3IDDmce0toSFs5vAlrbthIUI21H9/sviZEoYgwNM
ZAHTB45UrvZzkhuducthbtsepz8wS3KB+98Hsq7aI1uFBJBwR2+y0hRq+r56oZCO
71W0/tIDQf5bg6/AE6djoMr+PhXJdHuQZLtoXdKNMXwppl3JVR+aa1HZoPrnhp41
DCGKva0sLNo0zYi/WYS2Jk5J3l7oZ+4MxD/sUVMKhQIDAQABo2QwYjAdBgNVHQ4E
FgQU6iJKwg//DWah2STzmO1uXKIksfkwHwYDVR0jBBgwFoAU6iJKwg//DWah2STz
mO1uXKIksfkwDwYDVR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwR/AAABMA0GCSqG
SIb3DQEBCwUAA4IBAQCSeF+aJS35iyGpy3xdivOrEqrG+uZr6eWm343BofqmqEeO
4XKPVXDgRAPkIJiDKhus7tKwpzt/ljCRQQB9Oh6ptsctMh/rLk9Xr/31xOHAS9WZ
OyjD6ZjhuPiPJJkBkjpfvwCow6yHorTDroTFvEqefkeKXrpw8Dj2r8imX1gWheWk
SWsynfAL0uniG3u729abngjSh9jnop5vlm5rAyGsLdQyWY2oe9IoD/J40uUxgwWf
uYyz//FZawsYnJn1fvx7oH3vGwZqTCiwoX1t1X+VUC1vuhrvCpMdt5cFWAIim8hR
el40CmWceM5t7Tpss2QVTNnHt8e2h7Eg+T6kcL1K
-----END CERTIFICATE-----`;
const require = createRequire(import.meta.url);
const dshBin = require.resolve("@deepseek-ai/dsh/lib/bin.js");
const pnpmBin = process.env.npm_execpath;
assert.ok(pnpmBin, "package:smoke must run through pnpm");
const startupCwd = process.cwd();
const testBrowser = await resolveTestBrowser(process.env.UNIVER_RENDER_BROWSER, startupCwd);
const relativeTestBrowser = relative(startupCwd, testBrowser);
assert.equal(isAbsolute(relativeTestBrowser), false);
assert.equal(await resolveTestBrowser(relativeTestBrowser, startupCwd), testBrowser);
const sourceManifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const acceptedParitySurface = JSON.parse(await readFile(
  new URL("../test/fixtures/parity-accepted-surface.json", import.meta.url),
  "utf8",
));
for (const [id, outcome, , mode] of acceptedParitySurface.runnerCases) {
  assert.equal(id, `${outcome}.installed.${mode}`);
}
const expectedParityCaseIds = acceptedParitySurface.runnerCases.map(([id]) => id).sort();

async function resolveTestBrowser(value, cwd) {
  const configured = value?.trim();
  assert.ok(configured, "package:smoke requires an explicit UNIVER_RENDER_BROWSER");
  const path = await realpath(resolve(cwd, configured));
  await access(path, fsConstants.X_OK);
  return path;
}

function diagnostics(label, stdout, stderr) {
  return `${label}\nstdout:\n${stdout || "<empty>"}\nstderr:\n${stderr || "<empty>"}`;
}

async function waitWithin(promise, timeoutMs) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(timedOut), timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function signalTree(child, signal) {
  try {
    if (process.platform === "win32") {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    }
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function killAndReap(child, closed) {
  let result = await waitWithin(closed, 0);
  if (result !== timedOut) return result;

  signalTree(child, "SIGTERM");
  result = await waitWithin(closed, reapTimeoutMs);
  if (result !== timedOut) return result;

  signalTree(child, "SIGKILL");
  result = await waitWithin(closed, reapTimeoutMs);
  assert.notEqual(result, timedOut, `child ${child.pid} did not close after SIGKILL`);
  return result;
}

function contentWorkerPids(fixture) {
  return [...new Set(fixture.requests
    .map(({ workerPid }) => Number(workerPid))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
}

function installedContentWorkerProcessSet(rootPath) {
  if (process.platform === "win32") return new Set();
  const output = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  return new Set(output.split("\n").flatMap((line) =>
    line.includes("/node_modules/dsh-univer-work/dist/chunks/worker-child.mjs")
      && (rootPath === undefined || line.includes(rootPath))
      ? [Number(/^\s*(\d+)/u.exec(line)?.[1])]
      : []).filter((pid) => Number.isSafeInteger(pid) && pid > 0));
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessesToExit(pids, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (pids.some(processExists)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

async function terminateFixtureWorkers(pids) {
  for (const pid of pids) {
    if (processExists(pid)) process.kill(pid, "SIGTERM");
  }
  if (await waitForProcessesToExit(pids, reapTimeoutMs)) return;
  for (const pid of pids) {
    if (processExists(pid)) process.kill(pid, "SIGKILL");
  }
  assert.equal(await waitForProcessesToExit(pids, reapTimeoutMs), true,
    "installed fixture workers survived SIGKILL");
}

function run(command, args, { cwd, env, timeoutMs = commandTimeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== "win32",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let expired = false;
    const closed = Promise.withResolvers();
    const timeout = setTimeout(() => {
      expired = true;
      const deadlineError = new Error(
        diagnostics(`deadline exceeded: ${command} ${args.join(" ")}`, stdout, stderr),
      );
      void killAndReap(child, closed.promise).then(
        () => reject(deadlineError),
        (cleanupError) => reject(new AggregateError([deadlineError, cleanupError], deadlineError.message)),
      );
    }, timeoutMs);

    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(diagnostics(`failed to spawn: ${error.message}`, stdout, stderr)));
    });
    child.once("close", (code, signal) => {
      closed.resolve({ code, signal, stdout, stderr });
      clearTimeout(timeout);
      if (expired) return;
      if (code === 0 && signal === null) resolve({ stdout, stderr });
      else reject(new Error(diagnostics(`command exited with code ${code} signal ${signal}`, stdout, stderr)));
    });
  });
}

async function reservePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function startDiscoveryHttpsFixture() {
  const requests = [];
  const server = createHttpsServer({ cert: discoveryTlsCertificate, key: discoveryTlsKey }, (request, response) => {
    const url = new URL(request.url ?? "/", "https://127.0.0.1");
    if (url.pathname === "/__status") {
      const path = url.searchParams.get("path");
      const token = url.searchParams.get("token");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ count: requests.filter((entry) =>
        entry.path === path && entry.token === token).length }));
      return;
    }
    const entry = {
      authorization: request.headers.authorization ?? null,
      cookie: request.headers.cookie ?? null,
      path: url.pathname,
      token: url.searchParams.get("token"),
    };
    requests.push(entry);
    if (entry.authorization !== null || entry.cookie !== null) {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("credential headers are forbidden");
      return;
    }
    if (url.searchParams.get("hold") === "1") {
      request.once("close", () => {
        if (!response.destroyed) response.destroy();
      });
      return;
    }
    response.writeHead(200, { "content-type": "image/svg+xml" });
    response.end("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    origin: `https://127.0.0.1:${address.port}`,
    requests,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function startContentRuntimeFixture() {
  const cookie = "workspace_session=installed-runtime";
  const replacementCookie = "workspace_session=installed-runtime-replacement";
  const blocks = [];
  const ok = { code: ErrorCode.OK, message: "" };
  const slidePageIds = Array.from({ length: 10 }, (_, index) =>
    index === 0 ? "cover" : `page-${String(index + 1)}`);
  const { snapshot } = await transformWorkbookDataToSnapshot(
    {},
    {
      appVersion: "0.25.0",
      id: "unit-1",
      locale: "enUS",
      name: "Installed runtime smoke",
      resources: [],
      sheetOrder: ["sheet-1"],
      sheets: {
        "sheet-1": {
          cellData: { 0: { 0: { v: "runtime-smoke" } } },
          columnCount: 5,
          id: "sheet-1",
          name: "Sheet1",
          rowCount: 10,
        },
      },
      styles: {},
    },
    "unit-1",
    1,
    {
      saveSnapshot: async () => ({ error: ok }),
      updateSnapshot: async () => ({ error: ok }),
      saveSheetBlock: async (_context, request) => {
        assert.ok(request.block);
        blocks.push(request.block);
        return { blockID: request.block.id, error: ok };
      },
    },
  );
  const { snapshot: slideSnapshot } = await transformSlideDataToSnapshot(
    [],
    {
      activeSlideId: "cover",
      appVersion: "0.25.0",
      defaultPageSize: { height: 540, width: 960 },
      id: "slide-1",
      locale: "enUS",
      name: "Installed lint smoke",
      resources: [],
      rev: 1,
      slideOrder: slidePageIds,
      slides: Object.fromEntries(slidePageIds.map((id) => [id, {
          elementOrder: [],
          elements: {},
          id,
          name: id,
          pageType: "slide",
        }])),
    },
    "slide-1",
    1,
    {
      saveSnapshot: async () => ({ error: ok }),
      updateSnapshot: async () => ({ error: ok }),
      saveSheetBlock: async () => ({ blockID: "unused", error: ok }),
    },
  );
  const requests = [];
  let submitCount = 0;
  let svgSubmitCount = 0;
  let runtimeRevision = 1;
  let svgRuntimeRevision = 1;
  const events = [];
  const collaboration = createContentCollaborationSocketFixture((path) => events.push(path));
  const server = createHttpServer(async (request, response) => {
    requests.push({
      cookie: request.headers.cookie,
      path: request.url,
      role: request.headers["x-univer-cli-sdk-role"],
      workerPid: request.headers["x-univer-cli-sdk-worker-pid"],
    });
    if (request.method === "POST" && request.url === "/api/auth/cli/authorizations") {
      writeRuntimeJson(response, 200, {
        deviceCode: "d".repeat(43),
        expiresIn: 600,
        interval: 5,
        userCode: "ABCD-EFGH",
        verificationUriComplete: "/cli-login?userCode=ABCD-EFGH",
      });
      return;
    }
    if (request.method === "POST" && request.url === "/api/auth/cli/authorizations/exchange") {
      assert.deepEqual(await readRuntimeJson(request), { deviceCode: "d".repeat(43) });
      response.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": `${cookie}; Path=/; HttpOnly`,
      });
      response.end(JSON.stringify({
        authenticated: true,
        user: { displayName: "Installed User", id: "user-1" },
      }));
      return;
    }
    if (request.headers.cookie !== cookie && request.headers.cookie !== replacementCookie) {
      writeRuntimeJson(response, 401, { error: { code: "UNAUTHORIZED" } });
      return;
    }
    if (request.method === "GET" && request.url === "/api/session") {
      writeRuntimeJson(response, 200, {
        authenticated: true,
        user: { displayName: "Installed User", id: "user-1" },
      });
      return;
    }
    if (request.method === "DELETE" && request.url === "/api/session") {
      writeRuntimeJson(response, 200, {});
      return;
    }
    if (request.method === "GET" && request.url === "/__smoke/submissions") {
      writeRuntimeJson(response, 200, { count: submitCount });
      return;
    }
    if (request.method === "GET" && request.url === "/__smoke/svg-submissions") {
      writeRuntimeJson(response, 200, { count: svgSubmitCount });
      return;
    }
    if (request.method === "POST" && request.url === "/__smoke/reset") {
      runtimeRevision = 1;
      svgRuntimeRevision = 1;
      writeRuntimeJson(response, 200, { revision: runtimeRevision });
      return;
    }
    if (request.method === "GET" && request.url === "/universer-api/user/session-ticket") {
      writeRuntimeJson(response, 200, { ticket: "installed-runtime-ticket" });
      return;
    }
    if (request.method === "GET" && request.url === "/api/worktrees/wt-1") {
      writeRuntimeJson(response, 200, {
        worktree: {
          id: "wt-1",
          name: "Installed runtime",
          state: "draft",
          teamSpace: null,
          units: [{
            activationState: "notApplicable",
            change: "unchanged",
            draftHeadRevision: runtimeRevision,
            mergeResult: "pending",
            name: "Sheet",
            nodeId: "node-1",
            resourceId: "resource-1",
            source: "trunk",
            target: null,
            unitId: "unit-1",
            unitType: "sheet",
          }, {
            activationState: "notApplicable",
            change: "unchanged",
            draftHeadRevision: 1,
            mergeResult: "pending",
            name: "Slide",
            nodeId: "slide-node",
            resourceId: "slide-resource",
            source: "trunk",
            target: null,
            unitId: "slide-1",
            unitType: "slide",
          }],
        },
      });
      return;
    }
    if (
      request.method === "GET"
      && (
        request.url === "/universer-api/worktrees/wt-1/snapshot/2/unit/unit-1/rev/0"
        || request.url === "/universer-api/snapshot/2/unit/unit-1/rev/0"
      )
    ) {
      writeRuntimeJson(response, 200, { changesets: [], error: null, snapshot });
      return;
    }
    if (
      request.method === "GET"
      && request.url === "/universer-api/worktrees/wt-1/snapshot/3/unit/slide-1/rev/0"
    ) {
      writeRuntimeJson(response, 200, { changesets: [], error: null, snapshot: slideSnapshot });
      return;
    }
    if (
      request.method === "GET"
      && (
        request.url?.startsWith("/universer-api/worktrees/wt-1/snapshot/2/unit/unit-1/fetchmissing?")
        || request.url?.startsWith("/universer-api/snapshot/2/unit/unit-1/fetchmissing?")
      )
    ) {
      writeRuntimeJson(response, 200, {
        changesets: [],
        error: null,
        latestRevision: runtimeRevision,
      });
      return;
    }
    if (
      request.method === "GET"
      && request.url?.startsWith("/universer-api/worktrees/wt-1/snapshot/3/unit/slide-1/fetchmissing?")
    ) {
      writeRuntimeJson(response, 200, { changesets: [], error: null, latestRevision: svgRuntimeRevision });
      return;
    }
    const blockPrefix = [
      "/universer-api/worktrees/wt-1/snapshot/2/unit/unit-1/block/",
      "/universer-api/snapshot/2/unit/unit-1/block/",
    ].find((prefix) => request.url?.startsWith(prefix));
    if (request.method === "GET" && blockPrefix !== undefined) {
      const id = decodeURIComponent(request.url.slice(blockPrefix.length));
      const block = blocks.find((candidate) => candidate.id === id);
      writeRuntimeJson(
        response,
        block === undefined ? 404 : 200,
        block === undefined ? { error: { code: "NOT_FOUND" } } : { block, error: null },
      );
      return;
    }
    if (
      request.method === "POST"
      && request.url === "/universer-api/worktrees/wt-1/comb/2/unit/unit-1/new_changes"
    ) {
      const body = await readRuntimeJson(request);
      submitCount += 1;
      if (submitCount === 2) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        response.destroy();
        return;
      }
      collaboration.acknowledge(body.changeset);
      runtimeRevision = body.changeset.baseRev + 1;
      writeRuntimeJson(response, 200, { error: { code: 0, message: "" } });
      return;
    }
    if (
      request.method === "POST"
      && request.url === "/universer-api/worktrees/wt-1/comb/3/unit/slide-1/new_changes"
    ) {
      const body = await readRuntimeJson(request);
      svgSubmitCount += 1;
      if (svgSubmitCount === 2) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        response.destroy();
        return;
      }
      if (svgSubmitCount === 3) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        collaboration.acknowledge(body.changeset);
        svgRuntimeRevision = body.changeset.baseRev + 1;
        writeRuntimeJson(response, 200, { error: { code: 0, message: "" } });
        return;
      }
      collaboration.acknowledge(body.changeset);
      svgRuntimeRevision = body.changeset.baseRev + 1;
      writeRuntimeJson(response, 200, { error: { code: 0, message: "" } });
      return;
    }
    writeRuntimeJson(response, 404, { error: { code: "NOT_FOUND" } });
  });
  server.on("upgrade", (request, socket) => collaboration.upgrade(request, socket));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    blockIds: blocks.map(({ id }) => id),
    close: async () => {
      collaboration.close();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())));
    },
    cookie,
    events,
    origin: `http://127.0.0.1:${address.port}`,
    replacementCookie,
    requests,
    submissions: () => submitCount,
    svgSubmissions: () => svgSubmitCount,
  };
}

function createContentCollaborationSocketFixture(onEvent) {
  const peers = new Set();
  return {
    acknowledge(changeset) {
      const peer = [...peers].findLast((candidate) => candidate.joined.has(changeset.unitID));
      assert.ok(peer, "missing installed Collaboration peer");
      peer.send({
        cmd: CombCmd.RECV,
        code: CmdRspCode.OK,
        collaMsg: {
          csAckEvent: {
            cs: { ...changeset, memberID: "installed-runtime-member", revision: changeset.baseRev + 1 },
          },
          eventID: "changeset_ack",
        },
        routeKey: changeset.unitID,
      });
    },
    close() {
      for (const peer of peers) peer.socket.destroy();
    },
    closeActive() {
      for (const peer of peers) peer.socket.destroy();
    },
    upgrade(request, socket) {
      onEvent(`WS ${request.url ?? "<missing>"}`);
      socket.on("error", () => undefined);
      const key = request.headers["sec-websocket-key"];
      if (typeof key !== "string" || !request.url?.includes("/comb/connect")) {
        socket.destroy();
        return;
      }
      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write([
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"));
      const peer = createContentCollaborationSocketPeer(socket, (message) =>
        onEvent(`WS CMD ${String(message.cmd)} ${String(message.routeKey ?? "")}`));
      peers.add(peer);
      socket.once("close", () => peers.delete(peer));
    },
  };
}

function createContentCollaborationSocketPeer(socket, onMessage) {
  let buffer = Buffer.alloc(0);
  const joined = new Set();
  const send = (value) => {
    const payload = Buffer.from(JSON.stringify(value));
    const header = payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
    socket.write(Buffer.concat([header, payload]));
  };
  const handleMessage = (message) => {
    onMessage(message);
    if (message.cmd === CombCmd.HELLO) {
      const response = {
        cmd: CombCmd.HELLO,
        code: CmdRspCode.OK,
        infoRsp: { memberID: "installed-runtime-member" },
        routeKey: "",
      };
      send(response);
      onMessage({ cmd: `OUT-${String(response.cmd)}`, routeKey: response.routeKey });
    } else if (message.cmd === CombCmd.JOIN) {
      joined.add(message.routeKey);
      const response = {
        cmd: CombCmd.JOIN,
        code: CmdRspCode.OK,
        joinRsp: { roomInfos: {} },
        routeKey: message.routeKey,
      };
      send(response);
      onMessage({ cmd: `OUT-${String(response.cmd)}`, routeKey: response.routeKey });
    } else if (message.cmd === CombCmd.HEARTBEAT) {
      send({ cmd: CombCmd.HEARTBEAT, code: CmdRspCode.OK, routeKey: "" });
    }
  };
  const readFrame = () => {
    if (buffer.length < 2) return false;
    const first = buffer[0];
    const second = buffer[1];
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) return false;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return false;
      length = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }
    const masked = (second & 0x80) !== 0;
    const maskBytes = masked ? 4 : 0;
    if (buffer.length < offset + maskBytes + length) return false;
    const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
    offset += maskBytes;
    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    buffer = buffer.subarray(offset + length);
    if (mask !== undefined) {
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    }
    const opcode = first & 0x0f;
    if (opcode === 0x8) {
      socket.end(Buffer.from([0x88, 0x00]));
    } else if (opcode === 0x9) {
      socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
    } else if (opcode === 0x1) {
      handleMessage(JSON.parse(payload.toString("utf8")));
    }
    return true;
  };
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (readFrame()) {
      // Drain complete frames.
    }
  });
  return { joined, send, socket };
}

async function readRuntimeJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeRuntimeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body, (_key, value) =>
    value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value));
}

function watchHost(child, expectedReady) {
  let stdout = "";
  let stderr = "";
  const ready = Promise.withResolvers();
  const closed = Promise.withResolvers();
  const timeout = setTimeout(() => {
    ready.reject(new Error(diagnostics("Host startup deadline exceeded", stdout, stderr)));
  }, startupTimeoutMs);

  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
    if (stdout.includes(expectedReady)) ready.resolve();
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  child.once("error", (error) => {
    ready.reject(new Error(diagnostics(`Host spawn failed: ${error.message}`, stdout, stderr)));
  });
  child.once("close", (code, signal) => {
    ready.reject(new Error(diagnostics(`Host exited before readiness: code ${code} signal ${signal}`, stdout, stderr)));
    closed.resolve({ code, signal, stdout, stderr });
  });

  return {
    closed: closed.promise,
    output: () => ({ stdout, stderr }),
    ready: ready.promise.finally(() => clearTimeout(timeout)),
  };
}

async function smokeInstalledTools(profileRoot, runCwd, env, contentRuntimeFixture, discoveryHttpsFixture) {
  const script = `
    import assert from "node:assert/strict";
    import { execFileSync } from "node:child_process";
    import { chmod, mkdir, readFile, readdir, realpath, rm, stat, truncate, writeFile } from "node:fs/promises";
    import { createRequire, syncBuiltinESMExports } from "node:module";
    import { delimiter, dirname, isAbsolute, join, relative } from "node:path";
    import { pathToFileURL } from "node:url";
    import { inflateSync } from "node:zlib";
    const require = createRequire(${JSON.stringify(join(profileRoot, "package.json"))});
    const nodeFsPromises = require("node:fs/promises");
    const load = async (specifier) => await import(pathToFileURL(require.resolve(specifier)).href);
    const { Context } = await load("@deepseek-ai/cordis");
    const AgentRegistry = (await load("@deepseek-ai/dsh-agent")).default;
    const AgentLoop = (await load("@deepseek-ai/dsh-agent-loop")).default;
    const CodeRuntime = (await load("@deepseek-ai/dsh-code-runtime")).default;
    const llm = await load("@deepseek-ai/dsh-llm");
    const { CallId, createUserMessage, LlmAdapter } = llm;
    const LlmRuntime = llm.default;
    const session = await load("@deepseek-ai/dsh-session");
    const { Session, SessionId } = session;
    const SessionStore = session.default;
    const ToolRuntime = (await load("@deepseek-ai/dsh-tools")).default;
    const LocalFileSystem = (await load("@deepseek-ai/dsh-fs-local")).default;
    const SandboxedFileSystem = (await load("@deepseek-ai/dsh-fs-sandbox")).default;
    const SkillRegistry = (await load("@deepseek-ai/dsh-skill")).default;
    const FileSystemSkill = await load("@deepseek-ai/dsh-skill-filesystem");
    const ToolSkill = await load("@deepseek-ai/dsh-tool-skill");
    const SystemPrompt = (await load("@deepseek-ai/dsh-system-prompt")).default;
    const ApprovalService = (await load("@deepseek-ai/dsh-user-approval")).default;
    const plugin = await load("dsh-univer-work");
    const unhandledRejections = [];
    const recordUnhandledRejection = (reason) => { unhandledRejections.push(reason); };
    process.on("unhandledRejection", recordUnhandledRejection);
    const installedPluginEntry = require.resolve("dsh-univer-work");
    const installedProfileRoot = await realpath(${JSON.stringify(profileRoot)});
    const unrelatedRunCwd = await realpath(${JSON.stringify(runCwd)});
    const isolatedSkillProject = join(unrelatedRunCwd, "empty-skill-project");
    const isolatedDshSkillHome = join(unrelatedRunCwd, "empty-dsh-home");
    const isolatedAgentsSkillHome = join(unrelatedRunCwd, "empty-agents-home");
    await Promise.all([
      mkdir(join(isolatedSkillProject, ".dsh", "skills"), { recursive: true }),
      mkdir(join(isolatedSkillProject, ".agents", "skills"), { recursive: true }),
      mkdir(join(isolatedDshSkillHome, "skills"), { recursive: true }),
      mkdir(join(isolatedAgentsSkillHome, "skills"), { recursive: true }),
    ]);
    await writeFile(join(isolatedSkillProject, "package.json"), "{}\\n");
    const bundledSkillNames = ["base", "board", "cross-unit-formula", "doc", "embed", "sheet", "slide"];
    const expectedParityOutcomeIds = [
      "api-discovery",
      "authentication",
      "content",
      "file-transfer",
      "office",
      "render",
      "resource-discovery",
      "shell",
      "space-node",
      "svg",
      "typst",
      "unit-topic-skills",
      "worktree-unit",
    ];
    const expectedParityCaseIds = ${JSON.stringify(expectedParityCaseIds)};
    const parityCases = new Map(${JSON.stringify(acceptedParitySurface.runnerCases)}.map((entry) => [entry[0], entry]));
    const parsePackedSkill = (name, source) => {
      const match = source.match(/^---\\r?\\nname: ([^\\r\\n]+)\\r?\\ndescription: ([^\\r\\n]+)\\r?\\n---\\r?\\n\\r?\\n([\\s\\S]+)$/u);
      assert.ok(match, "invalid installed Skill " + name);
      assert.equal(match[1], name);
      return { description: match[2], content: match[3].trim() };
    };
    assert.equal(relative(installedProfileRoot, installedPluginEntry).startsWith(".."), false);
    assert.equal(relative(installedProfileRoot, unrelatedRunCwd).startsWith(".."), true);
    assert.deepEqual(Object.keys(plugin).sort(), ["apply", "inject", "name"]);
    const {
      MAX_RENDER_CANONICAL_BYTES,
      MAX_RENDER_CANONICAL_DEPTH,
      validateWorkspaceRenderResultBudget,
    } = await import(new URL("./chunks/render-result-budget.js", pathToFileURL(installedPluginEntry)).href);
    const renderBudgetError = (kind, limit, actual) => Object.assign(new Error(kind), {
      actual,
      kind,
      limit,
    });
    const validateInstalledRenderBudget = (value) => validateWorkspaceRenderResultBudget(
      value,
      () => renderBudgetError("malformed", 0, 0),
      renderBudgetError,
    );
    validateInstalledRenderBudget("x".repeat(MAX_RENDER_CANONICAL_BYTES - 2));
    assert.throws(
      () => validateInstalledRenderBudget("x".repeat(MAX_RENDER_CANONICAL_BYTES - 1)),
      {
        actual: MAX_RENDER_CANONICAL_BYTES + 1,
        kind: "render-result-bytes",
        limit: MAX_RENDER_CANONICAL_BYTES,
      },
    );
    let exactRenderDepth = "leaf";
    for (let depth = 0; depth < MAX_RENDER_CANONICAL_DEPTH; depth += 1) {
      exactRenderDepth = { next: exactRenderDepth };
    }
    validateInstalledRenderBudget(exactRenderDepth);
    assert.throws(
      () => validateInstalledRenderBudget({ next: exactRenderDepth }),
      {
        actual: MAX_RENDER_CANONICAL_DEPTH + 1,
        kind: "render-result-depth",
        limit: MAX_RENDER_CANONICAL_DEPTH,
      },
    );
    const installedPluginRequire = createRequire(installedPluginEntry);
    const installedPluginManifest = JSON.parse(await readFile(
      new URL("../package.json", pathToFileURL(installedPluginEntry)),
      "utf8",
    ));
    const installedPackageVersion = async (name) => {
      let directory = dirname(installedPluginRequire.resolve(name));
      for (;;) {
        const candidate = join(directory, "package.json");
        try {
          const value = JSON.parse(await readFile(candidate, "utf8"));
          if (value.name === name) return value.version;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        const parent = dirname(directory);
        if (parent === directory) throw new Error("missing installed package " + name);
        directory = parent;
      }
    };
    const installedPackageManifest = async (name) => {
      let directory = dirname(installedPluginRequire.resolve(name));
      for (;;) {
        const candidate = join(directory, "package.json");
        try {
          const value = JSON.parse(await readFile(candidate, "utf8"));
          if (value.name === name) return { path: await realpath(candidate), value };
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        const parent = dirname(directory);
        if (parent === directory) throw new Error("missing installed package " + name);
        directory = parent;
      }
    };
    const newProcessIdentities = (after, before) =>
      new Set([...after].filter((identity) => !before.has(identity)));
    assert.deepEqual(newProcessIdentities(new Set([20]), new Set([10, 20])), new Set(),
      "an exited baseline process must not fail the audit");
    assert.deepEqual(newProcessIdentities(new Set([20, 30]), new Set([10, 20])), new Set([30]),
      "a new process identity must fail the audit");
    const countByName = (values) => values.reduce((counts, name) => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      return counts;
    }, new Map());
    const volatileResources = () => countByName(process.getActiveResourcesInfo().filter((name) =>
      /^(?:ChildProcess|FSWatcher|Immediate|MessagePort|Timeout)$/u.test(name)));
    const volatileHandles = () => countByName(process._getActiveHandles()
      .map((handle) => handle?.constructor?.name ?? "unknown")
      .filter((name) => name !== "Socket"));
    const processListeners = () => new Map(process.eventNames().map((name) =>
      [String(name), process.listenerCount(name)]));
    const assertNoCountGrowth = (actual, baseline, label) => {
      for (const [name, count] of actual) {
        assert.ok(count <= (baseline.get(name) ?? 0), label + " leaked " + name);
      }
    };
    const settleLifecycleAudit = async (baseline, label) => {
      await new Promise((resolve) => setImmediate(resolve));
      assertNoCountGrowth(volatileResources(), baseline.resources, label + " resource");
      assertNoCountGrowth(volatileHandles(), baseline.handles, label + " handle");
      assertNoCountGrowth(processListeners(), baseline.listeners, label + " listener");
      assert.deepEqual(unhandledRejections, [], label + " produced an unhandled rejection");
    };
    const renderBrowserProcesses = () => {
      if (process.platform === "win32") return new Set();
      return new Set(execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" })
        .split("\\n")
        .flatMap((line) => line.includes("--remote-debugging-port=")
          ? [Number(/^\\s*(\\d+)/u.exec(line)?.[1])]
          : [])
        .filter((pid) => Number.isSafeInteger(pid) && pid > 0));
    };
    const systemTypstProcesses = () => {
      if (process.platform === "win32") return new Set();
      return new Set(execFileSync("ps", ["-axo", "pid=,comm="], { encoding: "utf8" })
        .split("\\n")
        .flatMap((line) => /(?:^|[/\\\\])typst(?:\\.exe)?$/iu.test(line.trim().split(/\\s+/u).at(-1) ?? "")
          ? [Number(/^\\s*(\\d+)/u.exec(line)?.[1])]
          : [])
        .filter((pid) => Number.isSafeInteger(pid) && pid > 0));
    };
    const inspectPng = (bytes) => {
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      let width;
      let height;
      let bitDepth;
      let colorType;
      const imageData = [];
      for (let offset = 8; offset < bytes.length;) {
        const length = bytes.readUInt32BE(offset);
        const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
        const data = bytes.subarray(offset + 8, offset + 8 + length);
        if (type === "IHDR") {
          width = data.readUInt32BE(0);
          height = data.readUInt32BE(4);
          bitDepth = data[8];
          colorType = data[9];
          assert.equal(data[12], 0, "interlaced PNG is outside the smoke decoder");
        } else if (type === "IDAT") imageData.push(data);
        offset += length + 12;
      }
      assert.equal(bitDepth, 8);
      assert.ok(colorType === 2 || colorType === 6);
      const bytesPerPixel = colorType === 6 ? 4 : 3;
      const stride = width * bytesPerPixel;
      const filtered = inflateSync(Buffer.concat(imageData));
      let cursor = 0;
      let previous = Buffer.alloc(stride);
      let darkest = 255;
      let lightest = 0;
      for (let y = 0; y < height; y += 1) {
        const filter = filtered[cursor++];
        const row = Buffer.alloc(stride);
        for (let x = 0; x < stride; x += 1) {
          const raw = filtered[cursor++];
          const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
          const above = previous[x];
          const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
          let predictor = 0;
          if (filter === 1) predictor = left;
          else if (filter === 2) predictor = above;
          else if (filter === 3) predictor = Math.floor((left + above) / 2);
          else if (filter === 4) {
            const estimate = left + above - upperLeft;
            const leftDistance = Math.abs(estimate - left);
            const aboveDistance = Math.abs(estimate - above);
            const upperLeftDistance = Math.abs(estimate - upperLeft);
            predictor = leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
              ? left
              : aboveDistance <= upperLeftDistance ? above : upperLeft;
          } else assert.equal(filter, 0, "unsupported PNG filter");
          row[x] = (raw + predictor) & 0xff;
        }
        for (let x = 0; x < stride; x += bytesPerPixel) {
          if (bytesPerPixel === 4 && row[x + 3] === 0) continue;
          const lightness = Math.round((row[x] + row[x + 1] + row[x + 2]) / 3);
          darkest = Math.min(darkest, lightness);
          lightest = Math.max(lightest, lightness);
        }
        previous = row;
      }
      assert.ok(darkest < 128 && lightest > 240, "rendered PNG lacks visible foreground/background contrast");
      return { height, width };
    };
    const opaqueIdentityKeys = new Set(["listId", "paragraphId", "rangeId", "sectionId"]);
    const collectOpaqueIdentities = (value) => {
      if (Array.isArray(value)) return value.flatMap(collectOpaqueIdentities);
      if (typeof value !== "object" || value === null) return [];
      return Object.entries(value).flatMap(([key, item]) =>
        opaqueIdentityKeys.has(key) && typeof item === "string"
          ? [item]
          : collectOpaqueIdentities(item));
    };
    const excludeOpaqueIdentities = (value) => {
      if (Array.isArray(value)) return value.map(excludeOpaqueIdentities);
      if (typeof value !== "object" || value === null) return value;
      return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !opaqueIdentityKeys.has(key))
        .map(([key, item]) => [key, excludeOpaqueIdentities(item)]));
    };
    for (const name of ["puppeteer-core", "@puppeteer/browsers"]) {
      const expected = installedPluginManifest.dependencies[name];
      assert.match(expected, /^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$/u);
      assert.equal(await installedPackageVersion(name), expected);
    }
    const typstWrapperName = "@univerjs-pro/doc-typst-native-binding";
    const typstWrapper = await installedPackageManifest(typstWrapperName);
    assert.equal(typstWrapper.value.version, installedPluginManifest.dependencies[typstWrapperName]);
    assert.equal(relative(await realpath(${JSON.stringify(profileRoot)}), typstWrapper.path).startsWith(".."), false);
    assert.deepEqual(installedPluginManifest.optionalDependencies, typstWrapper.value.optionalDependencies);
    const installedTypstPlatforms = [];
    for (const name of Object.keys(typstWrapper.value.optionalDependencies)) {
      try {
        installedTypstPlatforms.push(await installedPackageManifest(name));
      } catch (error) {
        if (error?.code !== "MODULE_NOT_FOUND" && !String(error).includes("missing installed package")) throw error;
      }
    }
    const currentTypstPlatform = installedTypstPlatforms.find(({ value }) =>
      value.os?.includes(process.platform) && value.cpu?.includes(process.arch));
    assert.ok(currentTypstPlatform, "installed Typst native platform package is missing");
    assert.equal(
      currentTypstPlatform.value.version,
      typstWrapper.value.optionalDependencies[currentTypstPlatform.value.name],
    );
    assert.equal(relative(await realpath(${JSON.stringify(profileRoot)}), currentTypstPlatform.path).startsWith(".."), false);
    assert.equal(process.env.UNIVER_RENDER_BROWSER, ${JSON.stringify(env.UNIVER_RENDER_BROWSER)});
    assert.equal(isAbsolute(process.env.UNIVER_RENDER_BROWSER), true);
    assert.equal(await realpath(process.env.UNIVER_RENDER_BROWSER), process.env.UNIVER_RENDER_BROWSER);
    const runtimeAuthenticated = {
      kind: "grant",
      payload: {
        state: "authenticated",
        origin: ${JSON.stringify(contentRuntimeFixture.origin)},
        cookie: ${JSON.stringify(contentRuntimeFixture.cookie)},
        subject: { id: "user-1", name: "Installed User" },
      },
    };
    const authenticated = runtimeAuthenticated;
    const runtimeReplacementAuthenticated = {
      kind: "grant",
      payload: {
        state: "authenticated",
        origin: ${JSON.stringify(contentRuntimeFixture.origin)},
        cookie: ${JSON.stringify(contentRuntimeFixture.replacementCookie)},
        subject: { id: "user-1", name: "Installed User" },
      },
    };
    let storedRecord = authenticated;
    let mode = "normal";
    let requestEntered;
    let releaseRequest;
    let transferStreamEntered;
    let transferStreamCancelled;
    let releaseTransferStream;
    let discoveryRequestEntered;
    let officeCreateEntered;
    let releaseOfficeCreate;
    let typstCreateEntered;
    let releaseTypstCreate;
    const transferRequests = [];
    const discoveryRequests = [];
    const allFetchRequests = [];
    const uploadedBodies = [];
    const officeCreateRequests = [];
    const typstCreateRequests = [];
    let typstUnitSequence = 0;
    let currentWorktreeName = "Draft";
    let currentWorktreeState = "draft";
    let currentDraftRevision = 1;
    const worktreeUnits = [];
    const node = (id, name, parentNodeId = null) => ({
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
      updatedAt: "2026-08-29T00:00:00.000Z",
    });
    const unit = (overrides = {}) => ({
      activationState: "notApplicable",
      change: "unchanged",
      draftHeadRevision: currentDraftRevision,
      mergeResult: "pending",
      name: "Sheet",
      nodeId: "node-1",
      resourceId: "resource-1",
      source: "trunk",
      target: null,
      unitId: "unit-1",
      unitType: "sheet",
      ...overrides,
    });
    const worktree = () => ({
      id: "wt-1",
      name: currentWorktreeName,
      state: currentWorktreeState,
      teamSpace: null,
      units: worktreeUnits,
    });
    const blobResource = (id = "blob-resource-1", size = 4) => ({
      availability: "ready",
      byteSize: size,
      capabilities: { downloadContent: true, editContent: false, openContent: false },
      id,
      kind: "blob",
      mediaType: "application/octet-stream",
    });
    const blobNode = (resource = blobResource(), name = "blob.bin") => ({
      ...node("blob-node-1", name),
      resource,
    });
    const uploadEnvelope = (state) => ({
      operation: {
        createdAt: "2026-08-29T00:00:00.000Z",
        error: null,
        id: "blob-operation-1",
        kind: "createBlobResource",
        result: state === "completed" ? { resourceId: "uploaded-resource-1" } : null,
        state: state === "completed" ? "completed" : "pending",
        updatedAt: "2026-08-29T00:00:00.000Z",
      },
      upload: {
        byteSize: 3,
        createdAt: "2026-08-29T00:00:00.000Z",
        detectedMediaType: state === "completed" ? "application/octet-stream" : null,
        expiresAt: "2026-08-30T00:00:00.000Z",
        id: "blob-upload-1",
        name: "installed-upload.bin",
        nodeId: "uploaded-node-1",
        operationId: "blob-operation-1",
        originalFilename: "installed-upload.bin",
        receivedSize: state === "waitingForUpload" ? null : 3,
        resourceId: "uploaded-resource-1",
        sha256: null,
        state,
        updatedAt: "2026-08-29T00:00:00.000Z",
      },
      uploadTarget: state === "waitingForUpload"
        ? { contentUrl: "/api/blob-upload-sessions/blob-upload-1/content", method: "PUT" }
        : null,
    });
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      allFetchRequests.push(request.method + " " + request.url);
      if (
        url.origin === ${JSON.stringify(contentRuntimeFixture.origin)}
        && (
          url.pathname.startsWith("/universer-api/snapshot/")
          || url.pathname.startsWith("/api/auth/cli/authorizations")
          || url.pathname === "/api/session"
        )
      ) return await nativeFetch(request);
      if (mode === "allowlisted") {
        return Response.json({ error: { code: "FORBIDDEN", message: "hidden" } }, { status: 403 });
      }
      if (mode === "unlisted") {
        return Response.json({ error: { code: "installed-private-code", message: "installed-private-code" } }, { status: 500 });
      }
      if (mode === "cancel-read") {
        requestEntered?.resolve();
        return await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("installed private abort")), { once: true });
        });
      }
      if (mode === "late-create" || mode === "late-read") {
        requestEntered?.resolve();
        await releaseRequest.promise;
      }
      if (mode === "unknown-trash" && url.pathname.endsWith("/trash")) {
        throw new Error("installed unknown response");
      }
      if (mode === "unknown-worktree" && url.pathname === "/api/worktrees" && init?.method === "POST") {
        throw new Error("installed unknown Worktree response");
      }
      if (url.pathname === "/api/spaces") {
        return Response.json({ spaces: [{ id: "space-1", name: "Personal", type: "personal" }] });
      }
      if (url.pathname === "/api/resources/blob-resource-1") {
        const resource = blobResource();
        return Response.json({ node: blobNode(resource), resource });
      }
      if (url.pathname === "/api/blob-resources/blob-resource-1/download") {
        if (mode === "dispose-combined") {
          let pulls = 0;
          return new Response(new ReadableStream({
            cancel() {
              transferStreamCancelled.resolve();
              return releaseTransferStream.promise;
            },
            pull(controller) {
              pulls += 1;
              if (pulls === 1) controller.enqueue(Buffer.from("bl"));
              else {
                transferStreamEntered.resolve();
                return new Promise(() => undefined);
              }
            },
          }), { headers: { "content-length": "4", "content-type": "application/octet-stream" } });
        }
        return new Response("blob", {
          headers: { "content-length": "4", "content-type": "application/octet-stream" },
        });
      }
      if (url.pathname === "/universer-api/worktrees/wt-1/file/asset-1/sign-url") {
        return Response.json({ error: { code: 1, message: "OK" }, url: "https://cdn.test/asset-1" });
      }
      if (url.origin === "https://cdn.test") {
        const request = new Request(input, init);
        assert.equal(request.headers.get("cookie"), null);
        return new Response("asset", {
          headers: { "content-length": "5", "content-type": "application/octet-stream" },
        });
      }
      if (url.origin === "https://cdn.jsdelivr.net") {
        assert.equal(request.headers.get("authorization"), null);
        assert.equal(request.headers.get("cookie"), null);
        discoveryRequests.push(request.url);
        const held = (
          (mode === "cancel-discovery" || mode === "dispose-combined")
          && url.pathname.includes("/color/")
        );
        const fixtureUrl = new URL(url.pathname, ${JSON.stringify(discoveryHttpsFixture.origin)});
        const holdToken = held ? mode + "-" + Math.random() : null;
        if (held) {
          fixtureUrl.searchParams.set("hold", "1");
          fixtureUrl.searchParams.set("token", holdToken);
        }
        const responsePromise = nativeFetch(fixtureUrl, {
          headers: request.headers,
          signal: request.signal,
        });
        if (held) {
          const statusUrl = new URL("/__status", ${JSON.stringify(discoveryHttpsFixture.origin)});
          statusUrl.searchParams.set("path", url.pathname);
          statusUrl.searchParams.set("token", holdToken);
          for (;;) {
            const status = await nativeFetch(statusUrl).then((response) => response.json());
            if (status.count > 0) break;
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          discoveryRequestEntered?.resolve();
        }
        return await responsePromise;
      }
      if (url.pathname === "/api/blob-upload-sessions" && init?.method === "POST") {
        transferRequests.push(request.method + " " + url.pathname);
        return Response.json(uploadEnvelope("waitingForUpload"));
      }
      if (url.pathname === "/api/blob-upload-sessions/blob-upload-1/content") {
        transferRequests.push(request.method + " " + url.pathname);
        uploadedBodies.push(Buffer.from(await request.arrayBuffer()).toString());
        if (mode === "cancel-blob-put") {
          requestEntered.resolve();
          await releaseRequest.promise;
        }
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/api/blob-upload-sessions/blob-upload-1") {
        transferRequests.push(request.method + " " + url.pathname);
        return Response.json(uploadEnvelope("uploaded"));
      }
      if (url.pathname === "/api/blob-upload-sessions/blob-upload-1/complete") {
        transferRequests.push(request.method + " " + url.pathname);
        const resource = blobResource("uploaded-resource-1", 3);
        return Response.json({
          operation: uploadEnvelope("completed").operation,
          node: { ...blobNode(resource, "installed-upload.bin"), id: "uploaded-node-1" },
        });
      }
      if (url.pathname === "/api/worktrees" && (init?.method ?? "GET") === "GET") {
        return Response.json({ items: [worktree()] });
      }
      if (url.pathname === "/api/worktrees" && init?.method === "POST") {
        currentWorktreeName = JSON.parse(String(init.body)).name;
        currentWorktreeState = "draft";
        return Response.json(worktree());
      }
      if (url.pathname === "/api/worktrees/wt-1" && init?.method === "PATCH") {
        return Response.json({ worktree: worktree() });
      }
      if (url.pathname === "/api/worktrees/wt-1" && (init?.method ?? "GET") === "GET") {
        return Response.json({ worktree: worktree() });
      }
      if (url.pathname === "/api/worktrees/wt-1/ready") {
        currentWorktreeState = "ready";
        return Response.json({ worktree: worktree() });
      }
      if (url.pathname === "/api/worktrees/wt-1/reopen") {
        currentWorktreeState = "draft";
        return Response.json({ worktree: worktree() });
      }
      if (url.pathname === "/api/worktrees/wt-1/discard") {
        currentWorktreeState = "discarded";
        return Response.json({ worktree: worktree() });
      }
      if (url.pathname === "/api/worktrees/wt-1/units" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        if (mode.startsWith("typst-")) {
          typstCreateRequests.push({
            body,
            cookie: request.headers.get("cookie"),
            idempotencyKey: request.headers.get("idempotency-key"),
            mode,
          });
          if (mode === "typst-result-unknown") throw new Error("installed-typst-http-secret");
          if (mode === "typst-cancel-create" || mode === "typst-dispose-create") {
            typstCreateEntered?.resolve();
            await releaseTypstCreate.promise;
            if (mode === "typst-cancel-create") throw new Error("installed-typst-cancel-secret");
          }
          if (mode === "typst-artifact-partial") {
            await mkdir(join(unrelatedRunCwd, "installed-typst-partial"), { mode: 0o700 });
            await writeFile(join(unrelatedRunCwd, "installed-typst-partial", "foreign.txt"), "foreign");
          }
          typstUnitSequence += 1;
          return Response.json({ unit: unit({
            name: body.name,
            nodeId: mode === "typst-unit-budget" ? "x".repeat(524_288) : "opaque-typst-node",
            resourceId: "opaque-typst-resource",
            source: "worktree",
            target: { parentNodeId: body.targetParentNodeId, spaceId: body.targetSpaceId },
            unitId: "opaque-typst-unit-" + typstUnitSequence,
            unitType: body.unitType,
          }) });
        }
        const isOfficeImport = Object.hasOwn(body, "initialData");
        if (isOfficeImport) {
          officeCreateRequests.push({
            body,
            idempotencyKey: request.headers.get("idempotency-key"),
          });
          if (mode === "office-create-unknown" || mode === "dispose-combined") {
            officeCreateEntered?.resolve();
            await releaseOfficeCreate.promise;
            if (mode === "office-create-unknown") throw new Error("installed-office-create-secret");
          }
          if (mode === "office-create-invalid") {
            return Response.json({ unit: { private: "installed-office-invalid-secret" } });
          }
          if (mode === "office-create-mismatch") {
            return Response.json({ unit: unit({
              name: body.name,
              source: "worktree",
              target: { parentNodeId: body.targetParentNodeId, spaceId: "space-other" },
              unitType: body.unitType,
            }) });
          }
        }
        const created = body.source === "trunk"
          ? unit()
          : unit({
              name: body.name,
              source: "worktree",
              target: { parentNodeId: body.targetParentNodeId, spaceId: body.targetSpaceId },
              unitType: body.unitType,
            });
        const renderSlide = worktreeUnits.find(({ unitId }) => unitId === "slide-1");
        worktreeUnits.splice(0, worktreeUnits.length, created, ...(renderSlide === undefined ? [] : [renderSlide]));
        return Response.json({ unit: created });
      }
      if (url.pathname === "/api/nodes" && init?.method === "POST") {
        return Response.json(node("created", "Created"));
      }
      if (url.pathname.endsWith("/trash")) {
        return Response.json({
          capabilities: { removePermanently: true, restore: true },
          id: "trash-1",
          nodeCount: 1,
          originalLocation: { breadcrumbs: [{ id: "node-1", name: "Folder" }] },
          removeBlockedBy: null,
          restoreBlockedBy: null,
          root: { id: "node-1", name: "Folder", resource: null },
          spaceId: "space-1",
          trashedAt: "2026-08-29T00:00:00.000Z",
          trashedBy: { avatarUrl: null, displayName: "Installed User", id: "user-1", username: "installed" },
        });
      }
      return Response.json({
        breadcrumbs: [],
        navigationRootNodeId: null,
        nextCursor: null,
        nodes: [],
        parentNode: null,
        space: { id: "space-1", name: "Personal", type: "personal" },
      });
    };
    let svgCtx;
    let typstCtx;
    let ctx;
    let codeCtx;
    try {
    const svgCwd = unrelatedRunCwd;
    await mkdir(join(svgCwd, "installed-svg", "assets"), { recursive: true });
    await writeFile(
      join(svgCwd, "installed-svg", "page.svg"),
      '<svg viewBox="0 0 320 180"><image href="assets/pixel.png" width="1" height="1"/><text x="12" y="36">Installed SVG</text></svg>',
    );
    await writeFile(
      join(svgCwd, "installed-svg", "assets", "pixel.png"),
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2NDNwAAAABJRU5ErkJggg==", "base64"),
    );
    svgCtx = new Context();
    await svgCtx.plugin(SystemPrompt, { persona: "" });
    await svgCtx.plugin(ToolRuntime);
    await svgCtx.plugin(SkillRegistry);
    await svgCtx.plugin(ApprovalService);
    await svgCtx.plugin(LocalFileSystem, { cwd: svgCwd });
    let svgCredentialReads = 0;
    let svgCredential = runtimeReplacementAuthenticated;
    svgCtx.provide("credentials", {
      async readRecord() { svgCredentialReads += 1; return svgCredential; },
      async modifyRecord(_key, mutate) { return await mutate(svgCredential); },
      async deleteRecord() {},
    });
    const svgApprovals = [];
    svgCtx.on("approval/request", (request) => {
      svgApprovals.push(request.toolName);
      return Promise.resolve("allowed-once");
    });
    const svgFiber = svgCtx.plugin(plugin);
    await svgFiber;
    assert.deepEqual(svgCtx.tools.schemas().map(({ name }) => name)
      .filter((name) => name.startsWith("workspace_svg_")).sort(), [
      "workspace_svg_apply",
      "workspace_svg_compile",
    ]);
    const svgSessionId = SessionId("installed-svg");
    const svgSession = Session.create(svgSessionId, [], {
      version: 0,
      id: svgSessionId,
      createdAt: 0,
      cwd: svgCwd,
    });
    svgSession.append("turn/start", { turn: 1 });
    svgSession.append("step/start", { turn: 1, step: 1 });
    const executeSvg = async (name, arguments_, signal = new AbortController().signal) =>
      await svgCtx.tools.execute({
        arguments: arguments_,
        callId: CallId("installed-" + name + "-" + Math.random()),
        name,
        signal,
        agent: { session: svgSession },
      });
    const svgBrowserBaseline = renderBrowserProcesses();
    const estimatedSvg = await executeSvg("workspace_svg_compile", {
      estimate_text_size: true,
      page: 1,
      source_path: "installed-svg/page.svg",
    });
    assert.equal(estimatedSvg.isError, false, JSON.stringify(estimatedSvg));
    assert.equal(estimatedSvg.value.textMeasure, "builtin-estimate");
    assert.match(estimatedSvg.value.generated.code, /presentation\.appendSlide\(\)/u);
    assert.match(estimatedSvg.value.generated.code, /insertImage/u);
    assert.ok(estimatedSvg.value.lints.some((lint) => lint.includes("sized by estimation")));
    assert.equal(svgCredentialReads, 0, "compile-only SVG read credentials");
    const realSvg = await executeSvg("workspace_svg_compile", {
      page: 1,
      source_path: "installed-svg/page.svg",
    });
    assert.equal(realSvg.isError, false, JSON.stringify(realSvg));
    assert.equal(realSvg.value.textMeasure, "univer-render-runtime");
    assert.match(realSvg.value.generated.code, /presentation\.appendSlide\(\)/u);
    assert.equal(svgCredentialReads, 0, "real-browser compile-only SVG read credentials");
    await writeFile(join(svgCwd, "installed-svg", "compiled.js"), "old installed SVG program");
    const savedSvg = await executeSvg("workspace_svg_compile", {
      estimate_text_size: true,
      output_path: "installed-svg/compiled.js",
      page: 1,
      source_path: "installed-svg/page.svg",
    });
    assert.equal(savedSvg.isError, false, JSON.stringify(savedSvg));
    assert.equal(savedSvg.value.generated.location, "installed-svg/compiled.js");
    assert.equal(
      await readFile(join(svgCwd, "installed-svg", "compiled.js"), "utf8"),
      estimatedSvg.value.generated.code + "\\n",
      "SVG compile did not replace the approved output with its exact program",
    );
    assert.equal(svgCredentialReads, 0, "approved compile-only SVG read credentials");
    const svgUnit = unit({
      draftHeadRevision: 1,
      name: "Installed SVG Slide",
      nodeId: "slide-node",
      resourceId: "slide-resource",
      unitId: "slide-1",
      unitType: "slide",
    });
    worktreeUnits.push(svgUnit);
    const appliedSvg = await executeSvg("workspace_svg_apply", {
      output_path: "installed-svg/program.js",
      page: 1,
      source_path: "installed-svg/page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    assert.equal(appliedSvg.isError, false, JSON.stringify(appliedSvg));
    assert.equal(appliedSvg.value.applied.committed, true);
    assert.equal(appliedSvg.value.generated.location, "installed-svg/program.js");
    assert.equal(
      await readFile(join(svgCwd, "installed-svg", "program.js"), "utf8"),
      realSvg.value.generated.code + "\\n",
      "SVG apply did not save the exact compiled program",
    );
    svgUnit.draftHeadRevision = appliedSvg.value.applied.revision;
    const partialSvg = await executeSvg("workspace_svg_apply", {
      estimate_text_size: true,
      output_path: "installed-svg/partial.js",
      page: 1,
      source_path: "installed-svg/page.svg",
      unit_id: "missing-slide",
      worktree_id: "wt-1",
    });
    assert.equal(partialSvg.error.info.code, "workspace-svg-apply-partial", JSON.stringify(partialSvg));
    const partialSvgEnvelope = JSON.parse(partialSvg.error.message.slice(partialSvg.error.message.indexOf("{")));
    assert.deepEqual(partialSvgEnvelope.detail.content, {
      causeCode: "WORKSPACE_UNIT_NOT_FOUND",
      state: "failed",
    });
    assert.match(await readFile(join(svgCwd, "installed-svg", "partial.js"), "utf8"), /presentation\.appendSlide\(\)/u);
    const unknownSvgAbort = new AbortController();
    const unknownSvgPending = executeSvg("workspace_svg_apply", {
      estimate_text_size: true,
      page: 1,
      source_path: "installed-svg/page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    }, unknownSvgAbort.signal);
    for (;;) {
      const response = await nativeFetch(${JSON.stringify(contentRuntimeFixture.origin)} + "/__smoke/svg-submissions", {
        headers: { cookie: ${JSON.stringify(contentRuntimeFixture.replacementCookie)} },
      });
      if ((await response.json()).count >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    unknownSvgAbort.abort(new Error("installed-svg-unknown-secret"));
    const unknownSvg = await unknownSvgPending;
    assert.equal(unknownSvg.error.info.code, "workspace-result-unknown", JSON.stringify(unknownSvg));
    assert.match(JSON.stringify(unknownSvg.content), /Inspect.*Worktree Unit.*Never.*replay/i);
    await nativeFetch(${JSON.stringify(contentRuntimeFixture.origin)} + "/__smoke/reset", {
      headers: { cookie: ${JSON.stringify(contentRuntimeFixture.replacementCookie)} },
      method: "POST",
    });
    svgUnit.draftHeadRevision = 1;
    svgCredential = runtimeAuthenticated;
    const svgAbort = new AbortController();
    svgAbort.abort(new Error("installed-svg-caller-secret"));
    const cancelledSvg = await executeSvg("workspace_svg_compile", {
      output_path: "installed-svg/cancelled.js",
      page: 1,
      source_path: "installed-svg/page.svg",
    }, svgAbort.signal);
    assert.equal(cancelledSvg.error.info.code, "ABORTED_BEFORE_DISPATCH");
    await assert.rejects(readFile(join(svgCwd, "installed-svg", "cancelled.js")), { code: "ENOENT" });
    const svgDisposeOrder = [];
    const disposingSvg = executeSvg("workspace_svg_apply", {
      estimate_text_size: true,
      output_path: "installed-svg/disposing.js",
      page: 1,
      source_path: "installed-svg/page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    }).finally(() => svgDisposeOrder.push("execution"));
    for (;;) {
      const response = await nativeFetch(${JSON.stringify(contentRuntimeFixture.origin)} + "/__smoke/svg-submissions", {
        headers: { cookie: ${JSON.stringify(contentRuntimeFixture.replacementCookie)} },
      });
      if ((await response.json()).count >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const svgDisposal = svgFiber.dispose().finally(() => svgDisposeOrder.push("dispose"));
    const svgSettlement = Promise.all([svgDisposal, disposingSvg]);
    let svgDisposalTimer;
    const svgDisposedWithinBound = await Promise.race([
      svgSettlement.then(() => true),
      new Promise((resolve) => { svgDisposalTimer = setTimeout(() => resolve(false), 5_000); }),
    ]);
    clearTimeout(svgDisposalTimer);
    assert.equal(svgDisposedWithinBound, true, "SVG owner disposal exceeded 5 seconds");
    const [, disposedSvg] = await svgSettlement;
    assert.equal(disposedSvg.isError, false, JSON.stringify(disposedSvg));
    assert.deepEqual(disposedSvg.value.applied, {
      committed: true,
      revision: 2,
      status: "committed",
      value: null,
    });
    assert.equal(disposedSvg.value.generated.location, "installed-svg/disposing.js");
    assert.deepEqual(svgDisposeOrder, ["execution", "dispose"]);
    assert.deepEqual(svgCtx.tools.schemas().filter(({ name }) => name.startsWith("workspace_svg_")), []);
    assert.equal(
      await readFile(join(svgCwd, "installed-svg", "disposing.js"), "utf8"),
      estimatedSvg.value.generated.code + "\\n",
      "SVG disposal replayed or changed the confirmed program",
    );
    const svgProjection = JSON.stringify([
      estimatedSvg,
      realSvg,
      savedSvg,
      appliedSvg,
      partialSvg,
      unknownSvg,
      cancelledSvg,
      disposedSvg,
    ]);
    assert.doesNotMatch(svgProjection, /installed-svg-(?:caller|unknown)-secret/u);
    assert.deepEqual(newProcessIdentities(renderBrowserProcesses(), svgBrowserBaseline), new Set(),
      "SVG left a browser process running");
    assert.equal(svgApprovals.filter((name) => name === "workspace_svg_compile").length, 1);
    assert.equal(svgApprovals.filter((name) => name === "workspace_svg_apply").length, 4);
    await svgCtx.fiber.dispose();
    svgCtx = undefined;
    worktreeUnits.splice(0);
    await nativeFetch(${JSON.stringify(contentRuntimeFixture.origin)} + "/__smoke/reset", {
      headers: { cookie: ${JSON.stringify(contentRuntimeFixture.replacementCookie)} },
      method: "POST",
    });
    const typstCwd = unrelatedRunCwd;
    const typstCommandMarker = join(typstCwd, "system-typst-was-called");
    const typstCommandDirectory = join(typstCwd, "invalid-system-typst-bin");
    await mkdir(typstCommandDirectory);
    const typstCommand = join(typstCommandDirectory, process.platform === "win32" ? "typst.cmd" : "typst");
    await writeFile(typstCommand, process.platform === "win32"
      ? ${JSON.stringify("@echo called>system-typst-was-called\r\n")}
      : ${JSON.stringify("#!/bin/sh\nprintf called > ")} + JSON.stringify(typstCommandMarker) + ${JSON.stringify("\n")});
    if (process.platform !== "win32") await chmod(typstCommand, 0o700);
    process.env.PATH = typstCommandDirectory + delimiter + process.env.PATH;
    process.env.TYPST_BIN = typstCommand;
    process.env.TYPST_FONT_PATHS = join(typstCwd, "invalid-typst-fonts");
    assert.equal(process.env.UNIVER_LICENSE, ${JSON.stringify("installed-typst-license-sentinel")});
    await mkdir(join(typstCwd, "installed-typst-bundle", "pages"), { recursive: true });
    await writeFile(
      join(typstCwd, "installed-typst-bundle", "pages", "one.typ"),
      "= Installed Native Typst\\n\\nHello from the packed native compiler.",
    );
    await writeFile(join(typstCwd, "installed-typst-bundle", "typst.json"), JSON.stringify({
      pages: ["pages/one.typ"],
      schemaVersion: 1,
      targetUnitId: "installed-typst-doc",
      title: "Installed Native Typst",
    }));
    typstCtx = new Context();
    await typstCtx.plugin(SystemPrompt, { persona: "" });
    await typstCtx.plugin(ToolRuntime);
    await typstCtx.plugin(SkillRegistry);
    await typstCtx.plugin(ApprovalService);
    await typstCtx.plugin(LocalFileSystem, { cwd: typstCwd });
    let typstCredentialReads = 0;
    typstCtx.provide("credentials", {
      async readRecord() { typstCredentialReads += 1; return storedRecord; },
      async modifyRecord(_key, mutate) {
        const next = await mutate(storedRecord);
        if (next !== undefined) storedRecord = next;
        return storedRecord;
      },
      async deleteRecord() { storedRecord = undefined; },
    });
    const typstApprovals = [];
    typstCtx.on("approval/request", (request) => {
      typstApprovals.push(request.toolName);
      return Promise.resolve("allowed-once");
    });
    const typstFiber = typstCtx.plugin(plugin);
    await typstFiber;
    assert.deepEqual(typstCtx.tools.schemas().map(({ name }) => name)
      .filter((name) => name.startsWith("workspace_typst_")).sort(), [
      "workspace_typst_apply",
      "workspace_typst_compile",
    ]);
    const typstSessionId = SessionId("installed-typst");
    const typstSession = Session.create(typstSessionId, [], {
      version: 0,
      id: typstSessionId,
      createdAt: 0,
      cwd: typstCwd,
    });
    typstSession.append("turn/start", { turn: 1 });
    typstSession.append("step/start", { turn: 1, step: 1 });
    const executeTypst = async (name, arguments_, signal = new AbortController().signal) =>
      await typstCtx.tools.execute({
        arguments: arguments_,
        callId: CallId("installed-" + name + "-" + Math.random()),
        name,
        signal,
        agent: { session: typstSession },
      });
    const typstFetchBaseline = allFetchRequests.length;
    const typstBrowserBaseline = renderBrowserProcesses();
    const typstProcessBaseline = systemTypstProcesses();
    storedRecord = undefined;
    const compiledTypst = await executeTypst("workspace_typst_compile", {
      artifact_directory: "installed-typst-artifacts",
      bundle_path: "installed-typst-bundle",
      render_previews: true,
    });
    assert.equal(compiledTypst.isError, false, JSON.stringify(compiledTypst));
    assert.equal(compiledTypst.value.committed, false);
    assert.equal(compiledTypst.value.targetUnitId, "installed-typst-doc");
    assert.ok(Array.isArray(compiledTypst.value.diagnostics));
    assert.equal(compiledTypst.value.artifactDirectory, "installed-typst-artifacts");
    assert.equal((await stat(join(typstCwd, "installed-typst-artifacts"))).mode & 0o777, 0o700);
    assert.equal((await stat(join(typstCwd, "installed-typst-artifacts", "program.js"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(typstCwd, "installed-typst-artifacts", "diagnostics.json"))).mode & 0o777, 0o600);
    for (const preview of compiledTypst.value.previews) {
      assert.equal(preview.sourcePath, "pages/one.typ");
      assert.equal(isAbsolute(preview.path), false);
      assert.deepEqual(inspectPng(await readFile(join(typstCwd, preview.path))).width > 0, true);
    }
    assert.equal(typstCredentialReads, 0, "compile-only Typst read credentials");
    assert.equal(allFetchRequests.length, typstFetchBaseline, "compile-only Typst used Workspace HTTP");
    const typstNoClobber = await executeTypst("workspace_typst_compile", {
      artifact_directory: "installed-typst-artifacts",
      bundle_path: "installed-typst-bundle",
    });
    assert.equal(typstNoClobber.error.info.code, "workspace-output-exists");
    const typstArgumentsWithBytes = (bytes) => {
      const base = { artifact_directory: "", bundle_path: "installed-typst-bundle" };
      const fixedBytes = Buffer.byteLength(JSON.stringify(base));
      assert.ok(fixedBytes < bytes);
      const value = { ...base, artifact_directory: "x".repeat(bytes - fixedBytes) };
      assert.equal(Buffer.byteLength(JSON.stringify(value)), bytes);
      return value;
    };
    const typstBudget = await executeTypst(
      "workspace_typst_compile",
      typstArgumentsWithBytes(524_288),
    );
    assert.equal(typstBudget.isError, true);
    assert.notEqual(typstBudget.error.info.code, "workspace-typst-limit-exceeded",
      "the exact argument boundary did not pass the pure budget gate");
    const typstBudgetPlusOne = await executeTypst(
      "workspace_typst_compile",
      typstArgumentsWithBytes(524_289),
    );
    assert.equal(typstBudgetPlusOne.error.info.code, "workspace-typst-limit-exceeded");
    const typstAbort = new AbortController();
    typstAbort.abort(new Error("installed-typst-cancel-secret"));
    const cancelledTypst = await executeTypst("workspace_typst_compile", {
      artifact_directory: "installed-typst-cancelled",
      bundle_path: "installed-typst-bundle",
    }, typstAbort.signal);
    assert.equal(cancelledTypst.isError, true);
    assert.doesNotMatch(JSON.stringify(cancelledTypst), /installed-typst-cancel-secret/u);
    await assert.rejects(readdir(join(typstCwd, "installed-typst-cancelled")), { code: "ENOENT" });
    storedRecord = authenticated;
    mode = "typst-apply";
    const appliedTypst = await executeTypst("workspace_typst_apply", {
      bundle_path: "installed-typst-bundle",
      idempotency_key: "installed-typst-apply",
      parent_node_id: "opaque-parent",
      space_id: "space-1",
      worktree_id: "wt-1",
    });
    mode = "normal";
    assert.equal(appliedTypst.isError, false, JSON.stringify(appliedTypst));
    assert.deepEqual({
      committed: appliedTypst.value.committed,
      unitId: appliedTypst.value.unit.unitId,
      worktreeId: appliedTypst.value.unit.worktreeId,
    }, { committed: true, unitId: "opaque-typst-unit-1", worktreeId: "wt-1" });
    assert.equal(typstCreateRequests.length, 1);
    assert.equal(typstCreateRequests[0].cookie, ${JSON.stringify(contentRuntimeFixture.cookie)});
    assert.equal(typstCreateRequests[0].idempotencyKey, "installed-typst-apply");
    assert.equal(typstCreateRequests[0].body.unitType, "doc");
    assert.equal(typstCreateRequests[0].body.targetParentNodeId, "opaque-parent");
    assert.match(JSON.stringify(typstCreateRequests[0].body.initialData), /Installed Native Typst/u);
    const firstTypstData = typstCreateRequests[0].body.initialData;
    const firstOpaqueIdentities = collectOpaqueIdentities(firstTypstData);
    assert.ok(firstOpaqueIdentities.length > 0);

    const uncertainBaseline = typstCreateRequests.length;
    mode = "typst-result-unknown";
    const uncertainTypst = await executeTypst("workspace_typst_apply", {
      bundle_path: "installed-typst-bundle",
      idempotency_key: "installed-typst-recovery",
      space_id: "space-1",
      worktree_id: "wt-1",
    });
    assert.equal(uncertainTypst.error.info.code, "workspace-result-unknown", JSON.stringify(uncertainTypst));
    const uncertainRequests = typstCreateRequests.slice(uncertainBaseline);
    assert.equal(uncertainRequests.length, 3);
    assert.equal(uncertainRequests.every(({ idempotencyKey }) =>
      idempotencyKey === "installed-typst-recovery"), true);
    const uncertainMessage = uncertainTypst.error.message;
    const uncertainEnvelope = JSON.parse(uncertainMessage.slice(
      uncertainMessage.indexOf("{"),
      uncertainMessage.indexOf(" Inspect"),
    ));
    assert.deepEqual(uncertainEnvelope.detail, {
      idempotencyKey: "installed-typst-recovery",
      name: "Installed Native Typst",
      parentNodeId: null,
      spaceId: "space-1",
      type: "doc",
      worktreeId: "wt-1",
    });
    assert.match(uncertainMessage, /workspace_unit_list/u);
    assert.match(uncertainMessage, /Never replay/u);

    mode = "typst-apply";
    const retriedTypst = await executeTypst("workspace_typst_apply", {
      bundle_path: "installed-typst-bundle",
      idempotency_key: "installed-typst-recovery",
      space_id: "space-1",
      worktree_id: "wt-1",
    });
    assert.equal(retriedTypst.isError, false, JSON.stringify(retriedTypst));
    assert.equal(retriedTypst.value.unit.unitId, "opaque-typst-unit-2");
    const retryRequest = typstCreateRequests.at(-1);
    assert.equal(retryRequest.idempotencyKey, "installed-typst-recovery");
    const retryOpaqueIdentities = collectOpaqueIdentities(retryRequest.body.initialData);
    assert.ok(retryOpaqueIdentities.length > 0);
    assert.notDeepEqual(retryOpaqueIdentities, firstOpaqueIdentities);
    assert.deepEqual(
      excludeOpaqueIdentities(retryRequest.body.initialData),
      excludeOpaqueIdentities(firstTypstData),
    );

    mode = "typst-artifact-partial";
    const partialTypst = await executeTypst("workspace_typst_apply", {
      artifact_directory: "installed-typst-partial",
      bundle_path: "installed-typst-bundle",
      idempotency_key: "installed-typst-partial",
      space_id: "space-1",
      worktree_id: "wt-1",
    });
    assert.equal(partialTypst.error.info.code, "workspace-typst-partial-side-effect",
      JSON.stringify(partialTypst));
    assert.match(JSON.stringify(partialTypst), /opaque-typst-unit-3/u);
    assert.match(JSON.stringify(partialTypst), /installed-typst-partial/u);
    assert.match(JSON.stringify(partialTypst), /Never replay/u);
    assert.equal(await readFile(join(typstCwd, "installed-typst-partial", "foreign.txt"), "utf8"), "foreign");

    mode = "typst-unit-budget";
    const oversizedUnitTypst = await executeTypst("workspace_typst_apply", {
      bundle_path: "installed-typst-bundle",
      idempotency_key: "installed-typst-unit-budget",
      space_id: "space-1",
      worktree_id: "wt-1",
    });
    assert.equal(oversizedUnitTypst.error.info.code, "workspace-typst-partial-side-effect",
      JSON.stringify(oversizedUnitTypst));

    typstCreateEntered = Promise.withResolvers();
    releaseTypstCreate = Promise.withResolvers();
    mode = "typst-cancel-create";
    const startedTypstAbort = new AbortController();
    const startedCancelledTypstPromise = executeTypst("workspace_typst_apply", {
      artifact_directory: "installed-typst-cancelled-started",
      bundle_path: "installed-typst-bundle",
      idempotency_key: "installed-typst-cancelled-started",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, startedTypstAbort.signal);
    await typstCreateEntered.promise;
    startedTypstAbort.abort(new Error("installed-typst-started-cancel-secret"));
    releaseTypstCreate.resolve();
    const startedCancelledTypst = await startedCancelledTypstPromise;
    assert.equal(startedCancelledTypst.error.info.code, "workspace-result-unknown",
      JSON.stringify(startedCancelledTypst));
    await assert.rejects(readdir(join(typstCwd, "installed-typst-cancelled-started")), { code: "ENOENT" });

    typstCreateEntered = Promise.withResolvers();
    releaseTypstCreate = Promise.withResolvers();
    mode = "typst-dispose-create";
    const ownerStoppedTypst = executeTypst("workspace_typst_apply", {
      artifact_directory: "installed-typst-disposing",
      bundle_path: "installed-typst-bundle",
      idempotency_key: "installed-typst-disposing",
      space_id: "space-1",
      worktree_id: "wt-1",
    });
    await typstCreateEntered.promise;
    let typstDisposed = false;
    const typstDisposal = typstFiber.dispose().then(() => { typstDisposed = true; });
    await Promise.resolve();
    const typstToolsDuringDispose = typstCtx.tools.schemas()
      .filter(({ name }) => name.startsWith("workspace_typst_"));
    const typstDisposeWaitedForCreate = !typstDisposed;
    releaseTypstCreate.resolve();
    const ownerStoppedTypstResult = await ownerStoppedTypst;
    let typstDisposalTimer;
    const typstDisposedWithinBound = await Promise.race([
      typstDisposal.then(() => true),
      new Promise((resolve) => { typstDisposalTimer = setTimeout(() => resolve(false), 5_000); }),
    ]);
    clearTimeout(typstDisposalTimer);
    assert.equal(typstDisposedWithinBound, true, "Typst owner disposal exceeded 5 seconds");
    assert.deepEqual(typstToolsDuringDispose, []);
    assert.equal(typstDisposeWaitedForCreate, true);
    assert.equal(ownerStoppedTypstResult.error.info.code, "workspace-typst-partial-side-effect",
      JSON.stringify(ownerStoppedTypstResult));
    await assert.rejects(readdir(join(typstCwd, "installed-typst-disposing")), { code: "ENOENT" });

    mode = "normal";
    const typstProjection = JSON.stringify([
      compiledTypst,
      typstNoClobber,
      typstBudget,
      typstBudgetPlusOne,
      cancelledTypst,
      appliedTypst,
      uncertainTypst,
      retriedTypst,
      partialTypst,
      oversizedUnitTypst,
      startedCancelledTypst,
      ownerStoppedTypstResult,
    ]);
    assert.doesNotMatch(typstProjection, new RegExp(RegExp.escape(typstCwd), "u"));
    assert.doesNotMatch(typstProjection, /installed-typst-(?:license|http|started-cancel)-secret/u);
    assert.deepEqual(newProcessIdentities(renderBrowserProcesses(), typstBrowserBaseline), new Set(),
      "Typst launched the Render browser");
    assert.deepEqual(newProcessIdentities(systemTypstProcesses(), typstProcessBaseline), new Set(),
      "Typst launched a system executable");
    await assert.rejects(readFile(typstCommandMarker), { code: "ENOENT" });
    assert.deepEqual((await readdir(typstCwd)).filter((name) => name.startsWith(".installed-typst-")), []);
    assert.equal(typstApprovals.filter((name) => name === "workspace_typst_compile").length, 1);
    assert.equal(typstApprovals.filter((name) => name === "workspace_typst_apply").length, 7);
    await typstCtx.fiber.dispose();
    typstCtx = undefined;
    ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SystemPrompt, { persona: "" });
    await ctx.plugin(ToolRuntime);
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(SkillRegistry);
    let skillProviderRegistrations = 0;
    const registerSkillProvider = ctx.skills.registerProvider.bind(ctx.skills);
    ctx.skills.registerProvider = (create) => {
      skillProviderRegistrations += 1;
      return registerSkillProvider(create);
    };
    await ctx.plugin(FileSystemSkill, {
      agentsHome: isolatedAgentsSkillHome,
      dshHome: isolatedDshSkillHome,
      watch: false,
    });
    const skillProviderBaseline = skillProviderRegistrations;
    await ctx.plugin(ToolSkill);
    await ctx.plugin(ApprovalService);
    await ctx.plugin(LocalFileSystem, { cwd: ${JSON.stringify(profileRoot)} });
    let credentialReads = 0;
    let credentialMutations = 0;
    ctx.provide("credentials", {
      async readRecord() { credentialReads += 1; return storedRecord; },
      async modifyRecord(_key, mutate) {
        credentialMutations += 1;
        try {
          const next = await mutate(storedRecord);
          if (next !== undefined) storedRecord = next;
          return storedRecord;
        } finally {
          credentialMutations -= 1;
        }
      },
      async deleteRecord() {
        credentialMutations += 1;
        try {
          storedRecord = undefined;
        } finally {
          credentialMutations -= 1;
        }
      },
    });
    let approvalOutcome = "allowed-once";
    const approvalRequests = [];
    ctx.on("approval/request", (request) => {
      approvalRequests.push({ toolName: request.toolName, reason: request.reason });
      return Promise.resolve(approvalOutcome);
    });
    const installedBaseSkillPath = join(dirname(installedPluginEntry), "..", "skills", "base", "SKILL.md");
    const installedBaseSkillSource = await readFile(installedBaseSkillPath, "utf8");
    await rm(installedBaseSkillPath);
    try {
      await assert.rejects(async () => { await ctx.plugin(plugin); }, /ENOENT|no such file/iu);
      assert.deepEqual(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_")), []);
      for (const name of bundledSkillNames) assert.equal(await ctx.skills.get(name), undefined);
    } finally {
      await writeFile(installedBaseSkillPath, installedBaseSkillSource);
    }
    await writeFile(installedBaseSkillPath, "invalid installed Skill");
    try {
      await assert.rejects(async () => { await ctx.plugin(plugin); }, /invalid bundled Workspace Skill definition: base/u);
      assert.deepEqual(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_")), []);
      for (const name of bundledSkillNames) assert.equal(await ctx.skills.get(name), undefined);
    } finally {
      await writeFile(installedBaseSkillPath, installedBaseSkillSource);
    }
    const lifecycleBaseline = {
      handles: volatileHandles(),
      listeners: processListeners(),
      resources: volatileResources(),
    };
    const fiber = ctx.plugin(plugin);
    await fiber;
    assert.equal(skillProviderRegistrations, skillProviderBaseline,
      "dsh-univer-work added a Skill provider/root/watcher owner");
    const names = () => ctx.tools.schemas()
      .map(({ name }) => name)
      .filter((name) => name.startsWith("workspace_"))
      .sort();
    assert.deepEqual(names(), [
      "workspace_api_find",
      "workspace_api_show",
      "workspace_asset_download",
      "workspace_auth_complete",
      "workspace_auth_logout",
      "workspace_auth_start",
      "workspace_auth_whoami",
      "workspace_blob_download",
      "workspace_blob_get",
      "workspace_blob_upload",
      "workspace_content_execute",
      "workspace_content_inspect",
      "workspace_layout_lint",
      "workspace_node_create",
      "workspace_node_move",
      "workspace_node_rename",
      "workspace_node_trash",
      "workspace_office_export",
      "workspace_office_import",
      "workspace_resource_export",
      "workspace_resource_find",
      "workspace_resource_registries",
      "workspace_screenshot",
      "workspace_space_browse",
      "workspace_space_find",
      "workspace_space_list",
      "workspace_svg_apply",
      "workspace_svg_compile",
      "workspace_typst_apply",
      "workspace_typst_compile",
      "workspace_unit_add",
      "workspace_unit_create",
      "workspace_unit_list",
      "workspace_worktree_create",
      "workspace_worktree_discard",
      "workspace_worktree_get",
      "workspace_worktree_list",
      "workspace_worktree_merge",
      "workspace_worktree_ready",
      "workspace_worktree_reopen",
      "workspace_worktree_review_url",
      "workspace_worktree_update",
    ]);
    const spaceNodeSchemas = ctx.tools.schemas().filter(({ name }) =>
      name.startsWith("workspace_space_") || name.startsWith("workspace_node_"));
    assert.equal(spaceNodeSchemas.length, 7);
    assert.equal(spaceNodeSchemas.every(({ parameters }) => parameters.additionalProperties === false), true);
    const worktreeUnitSchemas = ctx.tools.schemas().filter(({ name }) =>
      name.startsWith("workspace_worktree_") || name.startsWith("workspace_unit_"));
    assert.equal(worktreeUnitSchemas.length, 12);
    assert.equal(worktreeUnitSchemas.every(({ parameters }) => parameters.additionalProperties === false), true);
    const installedCwd = await realpath(${JSON.stringify(profileRoot)});
    const approvalSessionId = SessionId("installed-approval");
    const approvalSession = Session.create(approvalSessionId, [], {
      version: 0,
      id: approvalSessionId,
      createdAt: 0,
      cwd: installedCwd,
    });
    approvalSession.append("turn/start", { turn: 1 });
    approvalSession.append("step/start", { turn: 1, step: 1 });
    const approvalAgent = { session: approvalSession };
    const execute = async (name, args, options = {}) => await ctx.tools.execute({
      arguments: args,
      callId: CallId("installed-" + name + "-" + Math.random()),
      name,
      signal: options.signal ?? new AbortController().signal,
      ...(options.agent === undefined ? {} : { agent: options.agent }),
    });
    storedRecord = undefined;
    const keylessCredentialBaseline = credentialReads;
    const keylessFetchBaseline = allFetchRequests.length;
    const keylessApprovalBaseline = approvalRequests.length;
    const apiFind = await execute("workspace_api_find", { terms: ["setValues"], unit: "sheet", limit: 1 });
    const apiShow = await execute("workspace_api_show", { symbols: ["DefinitelyMissingWorkspaceApiSymbol"] });
    const resourceRegistries = await execute("workspace_resource_registries", {});
    const resourceFind = await execute("workspace_resource_find", { queries: ["arrow"], limit: 1 });
    for (const result of [apiFind, apiShow, resourceRegistries, resourceFind]) {
      assert.equal(result.isError, false, JSON.stringify(result));
      assert.ok(Buffer.byteLength(JSON.stringify(result.value), "utf8") <= 1024 * 1024);
    }
    assert.equal(apiFind.value.terms[0].term, "setValues");
    assert.equal(apiShow.value.results[0].status, "not-found");
    assert.ok(resourceRegistries.value.registries.length > 0);
    assert.equal(resourceFind.value.resources.length, 1);
    assert.equal(credentialReads, keylessCredentialBaseline);
    assert.equal(allFetchRequests.length, keylessFetchBaseline);
    assert.equal(approvalRequests.length, keylessApprovalBaseline);

    const nativeDiscoveryExport = await execute("workspace_resource_export", {
      handles: [
        "example-openmoji-black/1f10e",
        "example-openmoji-black/definitely-missing-resource",
      ],
      output_directory: "installed-discovery-native",
    }, { agent: approvalAgent });
    assert.equal(nativeDiscoveryExport.isError, false, JSON.stringify(nativeDiscoveryExport));
    assert.deepEqual(nativeDiscoveryExport.value, {
      complete: false,
      exported: [{
        handle: "example-openmoji-black/1f10e",
        path: join(installedCwd, "installed-discovery-native", "example-openmoji-black--1f10e.svg"),
      }],
      failed: [{
        handle: "example-openmoji-black/definitely-missing-resource",
        code: "resource-not-found",
      }],
    });
    assert.match(
      await readFile(join(installedCwd, "installed-discovery-native", "example-openmoji-black--1f10e.svg"), "utf8"),
      /^<svg/u,
    );
    assert.equal(
      (await stat(join(installedCwd, "installed-discovery-native", "example-openmoji-black--1f10e.svg"))).mode & 0o777,
      0o600,
    );
    assert.equal(credentialReads, keylessCredentialBaseline);
    assert.equal(approvalRequests.at(-1).toolName, "workspace_resource_export");
    assert.equal(discoveryRequests.length, 1);

    mode = "cancel-discovery";
    discoveryRequestEntered = Promise.withResolvers();
    const discoveryAbort = new AbortController();
    const cancelledDiscovery = execute("workspace_resource_export", {
      handles: ["example-openmoji-black/1f10e", "example-openmoji-color/1f10e"],
      output_directory: "installed-discovery-cancelled",
    }, { agent: approvalAgent, signal: discoveryAbort.signal });
    await discoveryRequestEntered.promise;
    discoveryAbort.abort(new Error("installed discovery private abort"));
    const cancelledDiscoveryResult = await cancelledDiscovery;
    assert.equal(cancelledDiscoveryResult.isError, true);
    assert.match(JSON.stringify(cancelledDiscoveryResult.content), /Inspect the approved output directory.*Never retry/i);
    assert.match(
      await readFile(join(installedCwd, "installed-discovery-cancelled", "example-openmoji-black--1f10e.svg"), "utf8"),
      /^<svg/u,
    );
    await assert.rejects(
      readFile(join(installedCwd, "installed-discovery-cancelled", "example-openmoji-color--1f10e.svg")),
      { code: "ENOENT" },
    );
    assert.doesNotMatch(JSON.stringify(cancelledDiscoveryResult), /installed discovery private abort/);
    mode = "normal";
    approvalRequests.length = 0;
    const startedAuthentication = await execute("workspace_auth_start", {
      origin: ${JSON.stringify(contentRuntimeFixture.origin)},
    });
    assert.equal(startedAuthentication.isError, false, JSON.stringify(startedAuthentication));
    assert.equal(startedAuthentication.value.status, "authorization_required");
    assert.equal(startedAuthentication.value.origin, ${JSON.stringify(contentRuntimeFixture.origin)});
    assert.equal(startedAuthentication.value.userCode, "ABCD-EFGH");
    assert.equal(
      startedAuthentication.value.verificationUrl,
      ${JSON.stringify(contentRuntimeFixture.origin)} + "/cli-login?userCode=ABCD-EFGH",
    );
    assert.ok(startedAuthentication.value.expiresAt > Date.now());
    const completedAuthentication = await execute("workspace_auth_complete", {});
    assert.equal(completedAuthentication.isError, false, JSON.stringify(completedAuthentication));
    assert.deepEqual(completedAuthentication.value, {
      origin: ${JSON.stringify(contentRuntimeFixture.origin)},
      status: "authenticated",
      subject: { id: "user-1", name: "Installed User" },
    });
    assert.deepEqual(storedRecord, runtimeAuthenticated);
    assert.equal((await execute("workspace_auth_start", { origin: "not-an-origin" })).isError, true);
    assert.equal((await execute("workspace_auth_whoami", {})).isError, false);

    const sentinel = "installed-invalid-cookie-sentinel";
    const invalid = await execute(
      "workspace_node_create",
      { space_id: "space-1", name: "Created", cookie: sentinel },
      { agent: approvalAgent },
    );
    assert.equal(invalid.error.info.code, "workspace-argument-invalid");
    assert.equal(approvalRequests.length, 0);
    assert.doesNotMatch(JSON.stringify(invalid), /installed-invalid-cookie-sentinel|cookie/);
    const direct = ctx.tools.get("workspace_node_create");
    await assert.rejects(
      direct.execute(
        { space_id: "space-1", name: "Created", path: sentinel },
        {
          arguments: {},
          callId: CallId("installed-direct"),
          rootCallId: CallId("installed-direct"),
          name: "workspace_node_create",
          signal: new AbortController().signal,
          token: Symbol("installed-direct"),
          deferContext() {},
          concludeTurn() {},
        },
      ),
      (error) => error.code === "workspace-argument-invalid",
    );

    const listed = await execute("workspace_space_list", {});
    assert.deepEqual(listed.value, { spaces: [{ id: "space-1", name: "Personal", type: "personal" }] });
    approvalOutcome = "rejected";
    assert.equal((await execute(
      "workspace_node_create",
      { space_id: "space-1", name: "Created" },
      { agent: approvalAgent },
    )).isError, true);
    approvalOutcome = "allowed-once";
    const created = await execute(
      "workspace_node_create",
      { space_id: "space-1", name: "Created" },
      { agent: approvalAgent },
    );
    assert.equal(created.isError, false, JSON.stringify(created));
    assert.equal(created.value.node.nodeId, "created");

    await writeFile(join(installedCwd, "installed-upload.bin"), "abc");
    const blobGet = await execute("workspace_blob_get", { resource_id: "blob-resource-1" });
    assert.equal(blobGet.value.resource.resourceId, "blob-resource-1");
    const blobUpload = await execute(
      "workspace_blob_upload",
      { source_path: "installed-upload.bin", space_id: "space-1", idempotency_key: "installed-blob-key" },
      { agent: approvalAgent },
    );
    assert.equal(blobUpload.isError, false, JSON.stringify(blobUpload));
    assert.equal(blobUpload.value.upload.uploadId, "blob-upload-1");
    assert.equal(uploadedBodies.at(-1), "abc");
    const blobDownload = await execute(
      "workspace_blob_download",
      { resource_id: "blob-resource-1", output_path: "installed-blob.bin" },
      { agent: approvalAgent },
    );
    assert.equal(blobDownload.isError, false, JSON.stringify(blobDownload));
    assert.equal(await readFile(join(installedCwd, "installed-blob.bin"), "utf8"), "blob");
    const assetDownload = await execute(
      "workspace_asset_download",
      { worktree_id: "wt-1", asset_id: "asset-1", output_path: "installed-asset.bin" },
      { agent: approvalAgent },
    );
    assert.equal(assetDownload.isError, false, JSON.stringify(assetDownload));
    assert.equal(await readFile(join(installedCwd, "installed-asset.bin"), "utf8"), "asset");
    const transferApprovalCount = approvalRequests.length;
    const closedTransfer = await execute(
      "workspace_blob_download",
      { resource_id: "blob-resource-1", output_path: "closed.bin", cookie: "installed-transfer-secret" },
      { agent: approvalAgent },
    );
    assert.equal(closedTransfer.error.info.code, "workspace-argument-invalid");
    assert.equal(approvalRequests.length, transferApprovalCount);
    assert.doesNotMatch(JSON.stringify(closedTransfer), /installed-transfer-secret|cookie/);
    const noClobber = await execute(
      "workspace_blob_download",
      { resource_id: "blob-resource-1", output_path: "installed-blob.bin" },
      { agent: approvalAgent },
    );
    assert.equal(noClobber.error.info.code, "workspace-blob-output-exists");
    assert.equal(await readFile(join(installedCwd, "installed-blob.bin"), "utf8"), "blob");
    const forced = await execute(
      "workspace_blob_download",
      { resource_id: "blob-resource-1", output_path: "installed-blob.bin", force: true },
      { agent: approvalAgent },
    );
    assert.equal(forced.isError, false, JSON.stringify(forced));
    assert.equal((await stat(join(installedCwd, "installed-blob.bin"))).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(installedCwd)).filter((name) => name.endsWith(".tmp")), []);
    assert.deepEqual(
      approvalRequests.filter(({ toolName }) =>
        toolName === "workspace_blob_upload"
        || toolName === "workspace_blob_download"
        || toolName === "workspace_asset_download").map(({ toolName }) => toolName),
      [
        "workspace_blob_upload",
        "workspace_blob_download",
        "workspace_asset_download",
        "workspace_blob_download",
        "workspace_blob_download",
      ],
    );

    const transferContext = async ({ filesystem, policy, approval = "allowed-once" }) => {
      const child = new Context();
      await child.plugin(SystemPrompt, { persona: "" });
      await child.plugin(ToolRuntime);
      await child.plugin(SkillRegistry);
      await child.plugin(ApprovalService);
      if (policy !== undefined) {
        child.provide("sandboxPolicy", { defaultMode: "workspace-write", resolve: policy });
      }
      if (typeof filesystem === "function") await child.plugin(filesystem, { cwd: installedCwd });
      else child.provide("fs", filesystem);
      let credentialReads = 0;
      child.provide("credentials", {
        async readRecord() { credentialReads += 1; return authenticated; },
        async modifyRecord(_key, mutate) { return await mutate(authenticated); },
        async deleteRecord() {},
      });
      const approvals = [];
      child.on("approval/request", (request) => {
        approvals.push(request.toolName);
        return typeof approval === "function" ? approval() : Promise.resolve(approval);
      });
      const childFiber = child.plugin(plugin);
      await childFiber;
      const childExecute = async (name, args, agent = approvalAgent) => await child.tools.execute({
        arguments: args,
        callId: CallId("installed-policy-" + Math.random()),
        name,
        signal: new AbortController().signal,
        ...(agent === undefined ? {} : { agent }),
      });
      return { approvals, child, childExecute, childFiber, credentialReads: () => credentialReads };
    };
    class InstalledConfiningLocalFileSystem extends LocalFileSystem {
      get sandboxMode() { return "workspace-write"; }
    }
    const policyRoot = join(installedCwd, "installed-policy-root");
    await mkdir(policyRoot, { recursive: true });
    const sandboxed = await transferContext({
      filesystem: SandboxedFileSystem,
      policy: () => ({ mode: "workspace-write", workspaceRoot: policyRoot }),
    });
    const outsidePolicy = await sandboxed.childExecute("workspace_blob_download", {
      resource_id: "blob-resource-1",
      output_path: "outside-installed-policy.bin",
    });
    assert.equal(outsidePolicy.error.info.code, "workspace-file-path-outside-session");
    assert.deepEqual(sandboxed.approvals, []);
    const insidePolicy = await sandboxed.childExecute("workspace_blob_download", {
      resource_id: "blob-resource-1",
      output_path: "installed-policy-root/sandboxed.bin",
    });
    assert.equal(insidePolicy.isError, false, JSON.stringify(insidePolicy));
    assert.deepEqual(sandboxed.approvals, ["workspace_blob_download"]);
    assert.equal(await readFile(join(policyRoot, "sandboxed.bin"), "utf8"), "blob");
    await sandboxed.childFiber.dispose();
    await sandboxed.child.fiber.dispose();

    const outsideCwd = join(installedCwd, "..", "installed-outside-cwd");
    await mkdir(outsideCwd, { recursive: true });
    const danger = await transferContext({
      filesystem: InstalledConfiningLocalFileSystem,
      policy: () => ({ mode: "danger-full-access", workspaceRoot: outsideCwd }),
    });
    const outsideDanger = await danger.childExecute("workspace_asset_download", {
      worktree_id: "wt-1",
      asset_id: "asset-1",
      output_path: join(outsideCwd, "asset.bin"),
    });
    assert.equal(outsideDanger.error.info.code, "workspace-file-path-outside-session");
    assert.deepEqual(danger.approvals, []);
    const insideDanger = await danger.childExecute("workspace_asset_download", {
      worktree_id: "wt-1",
      asset_id: "asset-1",
      output_path: "installed-danger.bin",
    });
    assert.equal(insideDanger.isError, false, JSON.stringify(insideDanger));
    assert.deepEqual(danger.approvals, ["workspace_asset_download"]);
    await danger.childFiber.dispose();
    await danger.child.fiber.dispose();

    const deniedTransferStart = transferRequests.length;
    const deniedTransfer = await transferContext({
      filesystem: LocalFileSystem,
      approval: "rejected",
    });
    const deniedUpload = await deniedTransfer.childExecute("workspace_blob_upload", {
      source_path: "installed-upload.bin",
      space_id: "space-1",
    });
    assert.equal(deniedUpload.isError, true);
    assert.deepEqual(deniedTransfer.approvals, ["workspace_blob_upload"]);
    assert.equal(deniedTransfer.credentialReads(), 0);
    assert.equal(transferRequests.length, deniedTransferStart);
    await deniedTransfer.childFiber.dispose();
    await deniedTransfer.child.fiber.dispose();

    const readOnly = await transferContext({
      filesystem: InstalledConfiningLocalFileSystem,
      policy: () => ({ mode: "read-only", workspaceRoot: installedCwd }),
    });
    const readOnlyResult = await readOnly.childExecute(
      "workspace_blob_download",
      { output_path: null, cookie: "installed-policy-secret" },
    );
    assert.equal(readOnlyResult.error.info.code, "workspace-file-policy-denied");
    assert.deepEqual(readOnly.approvals, []);
    assert.equal(readOnly.credentialReads(), 0);
    assert.doesNotMatch(JSON.stringify(readOnlyResult), /installed-policy-secret|cookie/);
    await readOnly.childFiber.dispose();
    await readOnly.child.fiber.dispose();

    const remoteCounts = { resolve: 0, contains: 0, processPath: 0 };
    const remote = await transferContext({
      filesystem: {
        sandboxMode: undefined,
        async resolve() { remoteCounts.resolve += 1; throw new Error("remote path secret"); },
        contains() { remoteCounts.contains += 1; return true; },
        processPath() { remoteCounts.processPath += 1; return "/remote"; },
      },
    });
    const remoteResult = await remote.childExecute("workspace_asset_download", {
      worktree_id: "wt-1",
      asset_id: "asset-1",
      output_path: "remote.bin",
    });
    assert.equal(remoteResult.error.info.code, "workspace-local-filesystem-required");
    assert.deepEqual(remoteCounts, { resolve: 0, contains: 0, processPath: 0 });
    assert.deepEqual(remote.approvals, []);
    assert.equal(remote.credentialReads(), 0);
    await remote.childFiber.dispose();
    await remote.child.fiber.dispose();

    let installedPolicyMode = "workspace-write";
    const installedAsked = Promise.withResolvers();
    const installedDecision = Promise.withResolvers();
    const narrowed = await transferContext({
      filesystem: InstalledConfiningLocalFileSystem,
      policy: () => ({ mode: installedPolicyMode, workspaceRoot: installedCwd }),
      approval: async () => { installedAsked.resolve(); return await installedDecision.promise; },
    });
    const narrowedPending = narrowed.childExecute("workspace_blob_download", {
      resource_id: "blob-resource-1",
      output_path: "installed-narrowed.bin",
    });
    await installedAsked.promise;
    installedPolicyMode = "read-only";
    installedDecision.resolve("allowed-once");
    const narrowedResult = await narrowedPending;
    assert.equal(narrowedResult.error.info.code, "workspace-file-policy-denied");
    assert.equal(narrowed.credentialReads(), 0);
    await narrowed.childFiber.dispose();
    await narrowed.child.fiber.dispose();

    const providerAsked = Promise.withResolvers();
    const providerDecision = Promise.withResolvers();
    const changedProvider = await transferContext({
      filesystem: LocalFileSystem,
      approval: async () => { providerAsked.resolve(); return await providerDecision.promise; },
    });
    const installedFilesystem = changedProvider.child.get("fs");
    const installedPrototype = Object.getPrototypeOf(installedFilesystem);
    const changedProviderPending = changedProvider.childExecute("workspace_blob_download", {
      resource_id: "blob-resource-1",
      output_path: "installed-provider-change.bin",
    });
    await providerAsked.promise;
    Object.setPrototypeOf(installedFilesystem, Object.prototype);
    providerDecision.resolve("allowed-once");
    const changedProviderResult = await changedProviderPending.finally(() => {
      Object.setPrototypeOf(installedFilesystem, installedPrototype);
    });
    assert.equal(changedProviderResult.error.info.code, "workspace-local-filesystem-required");
    assert.equal(changedProvider.credentialReads(), 0);
    await changedProvider.childFiber.dispose();
    await changedProvider.child.fiber.dispose();

    mode = "cancel-blob-put";
    requestEntered = Promise.withResolvers();
    releaseRequest = Promise.withResolvers();
    const transferRequestStart = transferRequests.length;
    const cancelledUploadController = new AbortController();
    const cancelledUploadPending = execute(
      "workspace_blob_upload",
      {
        source_path: "installed-upload.bin",
        space_id: "space-1",
        idempotency_key: "installed-cancelled-key",
      },
      { agent: approvalAgent, signal: cancelledUploadController.signal },
    );
    await requestEntered.promise;
    cancelledUploadController.abort(new Error("installed-transfer-password-cookie-sentinel"));
    releaseRequest.resolve();
    const cancelledUpload = await cancelledUploadPending;
    assert.equal(cancelledUpload.error.info.code, "workspace-result-unknown");
    assert.match(cancelledUpload.error.message, /installed-cancelled-key.*blob-upload-1.*waitingForUpload/);
    assert.match(JSON.stringify(cancelledUpload.content), /Never retry the upload automatically/i);
    assert.doesNotMatch(JSON.stringify(cancelledUpload), /installed-transfer-password-cookie-sentinel/);
    assert.deepEqual(transferRequests.slice(transferRequestStart), [
      "POST /api/blob-upload-sessions",
      "PUT /api/blob-upload-sessions/blob-upload-1/content",
    ]);
    assert.equal(uploadedBodies.at(-1), "abc");
    mode = "normal";

    const coreSkill = await ctx.skills.get("core");
    assert.equal(coreSkill.name, "core");
    assert.equal(coreSkill.source, "bundled");
    assert.equal(coreSkill.invocation.modelInvocable, true);
    assert.equal(coreSkill.invocation.userInvocable, true);
    assert.match(coreSkill.content, /workspace_worktree_review_url/);
    assert.doesNotMatch(coreSkill.content, /univer-workspace-cli|workspace_blob_|workspace_asset_download|workspace_content_|Web Client/i);
    const installedSkill = await readFile(
      new URL("../skills/core/SKILL.md", pathToFileURL(require.resolve("dsh-univer-work"))),
      "utf8",
    );
    assert.equal(coreSkill.content, installedSkill);
    const skillSession = Session.create(SessionId("installed-core-skill"));
    const loadedSkill = await execute("skill", { name: "core" }, { agent: { session: skillSession } });
    assert.equal(loadedSkill.isError, false, JSON.stringify(loadedSkill));
    assert.equal(loadedSkill.value.content, coreSkill.content);
    const skillCredentialBaseline = credentialReads;
    const skillApprovalBaseline = approvalRequests.length;
    const skillRequestBaseline = allFetchRequests.length;
    const skillBrowserBaseline = renderBrowserProcesses();
    const skillSummaries = (await ctx.skills.list({ cwd: isolatedSkillProject }))
      .filter(({ name }) => bundledSkillNames.includes(name));
    assert.deepEqual(skillSummaries.map(({ name }) => name), bundledSkillNames);
    assert.equal(skillSummaries.every(({ description, invocation, provider, source }) =>
      description.length > 0
      && invocation.modelInvocable
      && invocation.userInvocable
      && provider === "runtime"
      && source === "bundled"), true);
    for (const name of bundledSkillNames) {
      const packedSource = await readFile(
        new URL("../skills/" + name + "/SKILL.md", pathToFileURL(require.resolve("dsh-univer-work"))),
        "utf8",
      );
      const packedDefinition = parsePackedSkill(name, packedSource);
      const registeredSkill = await ctx.skills.get(name, { cwd: isolatedSkillProject });
      assert.equal(registeredSkill.description, packedDefinition.description);
      assert.equal(registeredSkill.content, packedDefinition.content);
      const id = SessionId("installed-bundled-skill-" + name);
      const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd: isolatedSkillProject });
      const loaded = await execute("skill", { name }, { agent: { session } });
      assert.equal(loaded.isError, false, JSON.stringify(loaded));
      assert.deepEqual(loaded.value, { name, provider: "runtime", content: packedDefinition.content });
    }
    assert.equal(credentialReads, skillCredentialBaseline);
    assert.equal(approvalRequests.length, skillApprovalBaseline);
    assert.equal(allFetchRequests.length, skillRequestBaseline);
    assert.deepEqual(newProcessIdentities(renderBrowserProcesses(), skillBrowserBaseline), new Set());
    assert.equal(skillProviderRegistrations, skillProviderBaseline);

    const worktreeSentinel = "installed-worktree-private-sentinel";
    const invalidWorktree = await execute(
      "workspace_worktree_create",
      { name: "Draft", scope: "user", cookie: worktreeSentinel },
      { agent: approvalAgent },
    );
    assert.equal(invalidWorktree.error.info.code, "workspace-argument-invalid");
    assert.equal(approvalRequests.filter(({ toolName }) => toolName === "workspace_worktree_create").length, 0);
    assert.doesNotMatch(JSON.stringify(invalidWorktree), /installed-worktree-private-sentinel|cookie/);
    const listedWorktrees = await execute("workspace_worktree_list", {});
    assert.equal(listedWorktrees.value.worktrees[0].id, "wt-1");
    const createdWorktree = await execute(
      "workspace_worktree_create",
      { name: "Draft", scope: "user", idempotency_key: "installed-worktree-key" },
      { agent: approvalAgent },
    );
    assert.equal(createdWorktree.value.worktree.id, "wt-1");
    const createdUnit = await execute(
      "workspace_unit_create",
      { worktree_id: "wt-1", space_id: "space-1", type: "sheet", name: "Sheet" },
      { agent: approvalAgent },
    );
    assert.equal(createdUnit.value.unit.source, "worktree");
    worktreeUnits.push(unit({
      name: "Slide",
      nodeId: "slide-node",
      resourceId: "slide-resource",
      unitId: "slide-1",
      unitType: "slide",
    }));
    storedRecord = runtimeAuthenticated;
    const installedScreenshot = await execute("workspace_screenshot", {
      output_directory: "installed-render",
      scope: "worktree",
      target: { kind: "sheet-range", range: "A1" },
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, { agent: approvalAgent });
    assert.equal(installedScreenshot.isError, false, JSON.stringify(installedScreenshot));
    assert.deepEqual(installedScreenshot.value, {
      kind: "workspace-screenshot",
      outputs: [{
        height: 48,
        location: join(installedCwd, "installed-render", "A1.png"),
        mediaType: "image/png",
        name: "A1.png",
        range: "A1",
        width: 176,
      }],
      unitId: "unit-1",
      unitType: "sheet",
    });
    const installedPng = await readFile(installedScreenshot.value.outputs[0].location);
    assert.deepEqual(inspectPng(installedPng), { height: 48, width: 176 });
    const installedLint = await execute("workspace_layout_lint", {
      pages: [1],
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    assert.equal(installedLint.isError, false, JSON.stringify(installedLint));
    assert.deepEqual(installedLint.value, {
      coverage: {
        pages: [{ page: 1, pageId: "cover" }],
        rules: ["text-off-page", "text-escapes-container", "text-overlaps-text"],
      },
      findings: [],
      kind: "unit-layout-lint",
      unitId: "slide-1",
      unitType: "slide",
    });
    const validRenderBrowser = process.env.UNIVER_RENDER_BROWSER;
    const missingBrowserSentinel = join(installedCwd, "installed-missing-browser-secret");
    const missingBrowserProcesses = renderBrowserProcesses();
    const missingBrowserFetchStart = allFetchRequests.length;
    process.env.UNIVER_RENDER_BROWSER = missingBrowserSentinel;
    const missingBrowser = await execute("workspace_screenshot", {
      output_directory: "installed-render-missing-browser",
      scope: "worktree",
      target: { kind: "sheet-range", range: "A1" },
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, { agent: approvalAgent });
    process.env.UNIVER_RENDER_BROWSER = validRenderBrowser;
    assert.equal(missingBrowser.error.info.code, "BROWSER_UNAVAILABLE");
    assert.match(JSON.stringify(missingBrowser), /Configure UNIVER_RENDER_BROWSER or install a supported browser/u);
    assert.doesNotMatch(JSON.stringify(missingBrowser), /installed-missing-browser-secret|checkedPaths|cacheDir|envVar/u);
    assert.deepEqual(renderBrowserProcesses(), missingBrowserProcesses);
    assert.equal(allFetchRequests.slice(missingBrowserFetchStart).every((entry) =>
      entry.includes(${JSON.stringify(contentRuntimeFixture.origin)})), true);
    await assert.rejects(readdir(join(installedCwd, "installed-render-missing-browser")), { code: "ENOENT" });
    const partialDirectory = join(installedCwd, "installed-render-partial");
    await mkdir(partialDirectory);
    const reservedPartial = join(partialDirectory, "page-02.png");
    const originalLink = nodeFsPromises.link;
    nodeFsPromises.link = async (existingPath, newPath) => {
      await originalLink(existingPath, newPath);
      if (newPath === join(partialDirectory, "page-01.png")) {
        await nodeFsPromises.writeFile(reservedPartial, "installed-existing-render-sentinel", { flag: "wx" });
      }
    };
    syncBuiltinESMExports();
    let partialScreenshot;
    try {
      partialScreenshot = await execute("workspace_screenshot", {
        output_directory: "installed-render-partial",
        scope: "worktree",
        target: { kind: "slide-pages", pages: Array.from({ length: 10 }, (_, index) => index + 1) },
        unit_id: "slide-1",
        worktree_id: "wt-1",
      }, { agent: approvalAgent });
    } finally {
      nodeFsPromises.link = originalLink;
      syncBuiltinESMExports();
    }
    assert.equal(partialScreenshot.isError, true, JSON.stringify(partialScreenshot));
    assert.equal(partialScreenshot.error.info.code, "workspace-screenshot-output-partial");
    assert.match(JSON.stringify(partialScreenshot.content), /Never recapture or retry automatically/u);
    const partialFiles = (await readdir(partialDirectory)).filter((name) => name.endsWith(".png")).sort();
    assert.deepEqual(partialFiles, ["page-01.png", "page-02.png"]);
    assert.equal(await readFile(reservedPartial, "utf8"), "installed-existing-render-sentinel");
    assert.equal((await readdir(partialDirectory)).some((name) => name.endsWith(".tmp")), false);
    assert.equal((await readFile(join(partialDirectory, "page-01.png"))).subarray(1, 4).toString("ascii"), "PNG");
    const renderCancelled = new AbortController();
    renderCancelled.abort(new Error("installed render caller cancellation"));
    const installedCancelledScreenshot = await execute("workspace_screenshot", {
      output_directory: "installed-render-cancelled",
      scope: "worktree",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, { agent: approvalAgent, signal: renderCancelled.signal });
    assert.equal(installedCancelledScreenshot.error.info.code, "ABORTED_BEFORE_DISPATCH");
    await assert.rejects(readdir(join(installedCwd, "installed-render-cancelled")), { code: "ENOENT" });
    const contentInspect = await execute("workspace_content_inspect", {
      scope: "worktree",
      worktree_id: "wt-1",
      unit_id: "unit-1",
      query: {
        kind: "worksheet-range",
        ranges: [{ worksheet: { index: 0 }, range: "A1" }],
      },
    });
    assert.equal(contentInspect.isError, false, JSON.stringify(contentInspect));
    assert.equal(contentInspect.value.kind, "worksheet-range");
    assert.equal(contentInspect.value.ranges[0].displayValues[0][0], "runtime-smoke");
    const trunkContentInspect = await execute("workspace_content_inspect", {
      scope: "trunk",
      unit_id: "unit-1",
      query: {
        kind: "worksheet-range",
        ranges: [{ worksheet: { index: 0 }, range: "A1" }],
      },
    });
    assert.equal(trunkContentInspect.isError, false, JSON.stringify(trunkContentInspect));
    assert.equal(trunkContentInspect.value.ranges[0].displayValues[0][0], "runtime-smoke");
    const contentNoMutation = await execute(
      "workspace_content_execute",
      { worktree_id: "wt-1", unit_id: "unit-1", code: "return { installed: 'no-mutation' };" },
      { agent: approvalAgent },
    );
    assert.deepEqual(contentNoMutation.value, {
      committed: false,
      value: { installed: "no-mutation" },
    });
    storedRecord = runtimeReplacementAuthenticated;
    ctx.emit("credentials/record-updated", "dsh-univer-work/workspace");
    const replacementScreenshot = await execute("workspace_screenshot", {
      output_directory: "installed-render-replacement",
      scope: "trunk",
      target: { kind: "sheet-range", range: "A1" },
      unit_id: "unit-1",
    }, { agent: approvalAgent });
    assert.equal(replacementScreenshot.isError, false, JSON.stringify(replacementScreenshot));
    assert.equal(
      (await readFile(replacementScreenshot.value.outputs[0].location)).subarray(1, 4).toString("ascii"),
      "PNG",
    );
    worktreeUnits.splice(1);
    const contentAfterCredentialReplacement = await execute("workspace_content_inspect", {
      scope: "worktree",
      worktree_id: "wt-1",
      unit_id: "unit-1",
      query: {
        kind: "worksheet-range",
        ranges: [{ worksheet: { index: 0 }, range: "A1" }],
      },
    });
    assert.equal(
      contentAfterCredentialReplacement.value.ranges[0].displayValues[0][0],
      "runtime-smoke",
    );
    const contentConfirmed = await execute(
      "workspace_content_execute",
      {
        worktree_id: "wt-1",
        unit_id: "unit-1",
        code: "const range = workbook.getActiveSheet().getRange('A1'); range.setValue('installed-confirmed'); return { value: range.getValue() };",
      },
      { agent: approvalAgent },
    );
    assert.equal(contentConfirmed.isError, false, JSON.stringify(contentConfirmed));
    assert.deepEqual(contentConfirmed.value, {
      committed: true,
      revision: 2,
      status: "committed",
      value: { value: "installed-confirmed" },
    });
    currentDraftRevision = 2;
    worktreeUnits[0].draftHeadRevision = currentDraftRevision;
    const contentConfirmedReadBack = await execute("workspace_content_inspect", {
      scope: "worktree",
      worktree_id: "wt-1",
      unit_id: "unit-1",
      query: {
        kind: "worksheet-range",
        ranges: [{ worksheet: { index: 0 }, range: "A1" }],
      },
    });
    assert.equal(contentConfirmedReadBack.isError, false, JSON.stringify(contentConfirmedReadBack));
    assert.equal(contentConfirmedReadBack.value.ranges[0].displayValues[0][0], "installed-confirmed");
    const unknownController = new AbortController();
    const contentUnknownPending = execute(
      "workspace_content_execute",
      {
        worktree_id: "wt-1",
        unit_id: "unit-1",
        code: "workbook.getActiveSheet().getRange('A2').setValue('installed-unknown'); return null;",
      },
      { agent: approvalAgent, signal: unknownController.signal },
    );
    for (;;) {
      const response = await nativeFetch(${JSON.stringify(contentRuntimeFixture.origin)} + "/__smoke/submissions", {
        headers: { cookie: ${JSON.stringify(contentRuntimeFixture.cookie)} },
      });
      const observed = await response.json();
      if (observed.count >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    unknownController.abort(new Error("installed commit outcome unknown"));
    const contentUnknown = await contentUnknownPending;
    assert.equal(contentUnknown.error.info.code, "workspace-result-unknown");
    assert.match(JSON.stringify(contentUnknown.content), /workspace_worktree_get.*workspace_content_inspect.*Never replay/i);
    storedRecord = authenticated;
    ctx.emit("credentials/record-updated", "dsh-univer-work/workspace");
    assert.equal((await execute("workspace_unit_list", { worktree_id: "wt-1" })).value.units.length, 1);
    const ready = await execute(
      "workspace_worktree_ready",
      { worktree_id: "wt-1" },
      { agent: approvalAgent },
    );
    assert.equal(ready.value.worktree.state, "ready");
    const review = await execute("workspace_worktree_review_url", { worktree_id: "wt-1" });
    assert.equal(
      review.value.review.openUrl,
      ${JSON.stringify(contentRuntimeFixture.origin)} + "/worktrees?worktree=wt-1&unit=unit-1&view=agent",
    );
    assert.equal((await execute(
      "workspace_worktree_reopen",
      { worktree_id: "wt-1" },
      { agent: approvalAgent },
    )).value.worktree.state, "draft");
    assert.equal((await execute(
      "workspace_worktree_discard",
      { worktree_id: "wt-1" },
      { agent: approvalAgent },
    )).value.worktree.state, "discarded");
    mode = "unknown-worktree";
    const unknownWorktree = await execute(
      "workspace_worktree_create",
      { name: "Unknown Draft", scope: "user", idempotency_key: "installed-unknown-key" },
      { agent: approvalAgent },
    );
    assert.equal(unknownWorktree.error.info.code, "workspace-result-unknown");
    assert.match(JSON.stringify(unknownWorktree.content), /workspace_worktree_list.*Never replay/i);

    mode = "allowlisted";
    const allowedFailure = await execute("workspace_space_list", {});
    assert.equal(allowedFailure.error.info.code, "FORBIDDEN");
    mode = "unlisted";
    const hiddenFailure = await execute("workspace_space_list", {});
    assert.equal(hiddenFailure.error.info.code, "workspace-operation-failed");
    assert.doesNotMatch(JSON.stringify(hiddenFailure), /installed-private-code/);

    mode = "normal";
    const beforeDispatch = new AbortController();
    beforeDispatch.abort(new Error("already stopped"));
    assert.equal((await execute(
      "workspace_node_create",
      { space_id: "space-1", name: "Created" },
      { agent: approvalAgent, signal: beforeDispatch.signal },
    )).error.info.code, "ABORTED_BEFORE_DISPATCH");

    mode = "cancel-read";
    requestEntered = Promise.withResolvers();
    const cancelledController = new AbortController();
    const cancelledRead = execute("workspace_space_list", {}, { signal: cancelledController.signal });
    await requestEntered.promise;
    cancelledController.abort(new Error("cancel read"));
    const cancelledResult = await cancelledRead;
    assert.equal(cancelledResult.error.info.code, "workspace-operation-cancelled");

    mode = "late-create";
    requestEntered = Promise.withResolvers();
    releaseRequest = Promise.withResolvers();
    const lateController = new AbortController();
    const lateMutation = execute(
      "workspace_node_create",
      { space_id: "space-1", name: "Created" },
      { agent: approvalAgent, signal: lateController.signal },
    );
    await requestEntered.promise;
    lateController.abort(new Error("late caller abort"));
    releaseRequest.resolve();
    const lateResult = await lateMutation;
    assert.equal(lateResult.error.info.code, "ABORTED");
    assert.match(JSON.stringify(lateResult.content), /workspace_space_browse.*workspace_space_find.*Never replay/i);

    mode = "unknown-trash";
    const unknown = await execute(
      "workspace_node_trash",
      { node_id: "node-1" },
      { agent: approvalAgent },
    );
    assert.equal(unknown.error.info.code, "workspace-result-unknown");
    mode = "normal";
    currentDraftRevision = 1;
    await nativeFetch(${JSON.stringify(contentRuntimeFixture.origin)} + "/__smoke/reset", {
      headers: { cookie: ${JSON.stringify(contentRuntimeFixture.replacementCookie)} },
      method: "POST",
    });
    storedRecord = runtimeReplacementAuthenticated;
    ctx.emit("credentials/record-updated", "dsh-univer-work/workspace");
    currentWorktreeState = "draft";
    worktreeUnits.splice(0, worktreeUnits.length, unit({
      draftHeadRevision: 1,
      name: "Installed runtime smoke",
      source: "worktree",
      target: { parentNodeId: null, spaceId: "space-1" },
    }));
    const officeApprovalStart = approvalRequests.length;
    const officeExport = await execute(
      "workspace_office_export",
      { output_path: "installed-office.xlsx", unit_id: "unit-1", worktree_id: "wt-1" },
      { agent: approvalAgent },
    );
    assert.equal(officeExport.isError, false, JSON.stringify(officeExport));
    assert.equal(officeExport.value.type, "sheet");
    const installedOfficePath = officeExport.value.outputPath;
    assert.equal(installedOfficePath.endsWith("/installed-office.xlsx"), true);
    assert.ok((await stat(installedOfficePath)).size > 0, "installed native XLSX export was empty");
    const officeNoClobber = await execute(
      "workspace_office_export",
      { output_path: "installed-office.xlsx", unit_id: "unit-1", worktree_id: "wt-1" },
      { agent: approvalAgent },
    );
    assert.equal(officeNoClobber.error.info.code, "workspace-office-output-exists");
    const officeForced = await execute(
      "workspace_office_export",
      { force: true, output_path: "installed-office.xlsx", unit_id: "unit-1", worktree_id: "wt-1" },
      { agent: approvalAgent },
    );
    assert.equal(officeForced.isError, false, JSON.stringify(officeForced));
    assert.equal((await stat(installedOfficePath)).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(installedCwd)).filter((name) => name.endsWith(".tmp")), []);
    const officeCreateStart = officeCreateRequests.length;
    const officeImport = await execute(
      "workspace_office_import",
      {
        name: "Installed XLSX roundtrip",
        source_path: "installed-office.xlsx",
        space_id: "space-1",
        worktree_id: "wt-1",
      },
      { agent: approvalAgent },
    );
    assert.equal(officeImport.isError, false, JSON.stringify(officeImport));
    assert.equal(officeImport.value.committed, true);
    assert.equal(officeImport.value.name, "Installed XLSX roundtrip");
    assert.equal(officeImport.value.type, "sheet");
    assert.equal(officeImport.value.sourcePath, installedOfficePath);
    assert.equal(officeCreateRequests.length, officeCreateStart + 1);
    assert.equal(
      officeCreateRequests.at(-1).body.initialData.sheets[
        officeCreateRequests.at(-1).body.initialData.sheetOrder[0]
      ].cellData[0][0].v,
      "runtime-smoke",
    );
    for (const [suffix, type] of [["docx", "doc"], ["pptx", "slide"]]) {
      await writeFile(join(installedCwd, "installed-strict." + suffix), "not-an-office-container");
      const strictStart = officeCreateRequests.length;
      const strictResult = await execute(
        "workspace_office_import",
        {
          source_path: "installed-strict." + suffix,
          space_id: "space-1",
          type,
          worktree_id: "wt-1",
        },
        { agent: approvalAgent },
      );
      assert.equal(strictResult.error.info.code, "workspace-office-conversion-failed");
      assert.equal(officeCreateRequests.length, strictStart);
    }
    const oversizedOfficePath = join(installedCwd, "installed-office-oversized.xlsx");
    await writeFile(oversizedOfficePath, "");
    await truncate(oversizedOfficePath, 52_428_801);
    const oversizedCreateStart = officeCreateRequests.length;
    const oversizedOffice = await execute(
      "workspace_office_import",
      {
        source_path: "installed-office-oversized.xlsx",
        space_id: "space-1",
        worktree_id: "wt-1",
      },
      { agent: approvalAgent },
    );
    assert.equal(oversizedOffice.error.info.code, "workspace-office-limit-exceeded");
    assert.equal(oversizedOffice.error.message.includes('"kind":"source-bytes"'), true);
    assert.equal(oversizedOffice.error.message.includes('"limit":52428800'), true);
    assert.equal(oversizedOffice.error.message.includes('"actual":52428801'), true);
    assert.equal(officeCreateRequests.length, oversizedCreateStart);
    currentDraftRevision = 2;
    worktreeUnits[0].draftHeadRevision = 2;
    const officeRevisionMismatch = await execute(
      "workspace_office_export",
      { output_path: "installed-office-race.xlsx", unit_id: "unit-1", worktree_id: "wt-1" },
      { agent: approvalAgent },
    );
    assert.equal(officeRevisionMismatch.error.info.code, "workspace-result-mismatch");
    await assert.rejects(readFile(join(installedCwd, "installed-office-race.xlsx")), { code: "ENOENT" });
    currentDraftRevision = 1;
    worktreeUnits[0].draftHeadRevision = 1;
    const officeOutcomeResults = [];
    for (const outcome of ["unknown", "mismatch", "invalid"]) {
      mode = "office-create-" + outcome;
      const outcomeStart = officeCreateRequests.length;
      let pending;
      let controller;
      if (outcome === "unknown") {
        officeCreateEntered = Promise.withResolvers();
        releaseOfficeCreate = Promise.withResolvers();
        controller = new AbortController();
        pending = execute(
          "workspace_office_import",
          { source_path: "installed-office.xlsx", space_id: "space-1", worktree_id: "wt-1" },
          { agent: approvalAgent, signal: controller.signal },
        );
        await officeCreateEntered.promise;
        controller.abort(new Error("installed-office-caller-secret"));
        releaseOfficeCreate.resolve();
      } else {
        pending = execute(
          "workspace_office_import",
          { source_path: "installed-office.xlsx", space_id: "space-1", worktree_id: "wt-1" },
          { agent: approvalAgent },
        );
      }
      const result = await pending;
      officeOutcomeResults.push(result);
      const expectedCode = outcome === "unknown"
        ? "workspace-result-unknown"
        : outcome === "mismatch"
          ? "workspace-result-mismatch"
          : "workspace-invalid-response";
      assert.equal(result.error.info.code, expectedCode, JSON.stringify(result));
      assert.equal(officeCreateRequests.length, outcomeStart + 1);
      assert.match(JSON.stringify(result.content), /workspace_unit_list.*workspace_worktree_get.*Never replay/i);
      assert.doesNotMatch(JSON.stringify(result), /installed-office-(?:caller|create|invalid)-secret/);
      if (outcome === "unknown") {
        assert.match(
          officeCreateRequests.at(-1).idempotencyKey,
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      }
    }
    mode = "normal";
    assert.deepEqual(
      approvalRequests.slice(officeApprovalStart),
      [
        ["workspace_office_export", "Workspace Office export writes a Host-local file."],
        ["workspace_office_export", "Workspace Office export writes a Host-local file."],
        ["workspace_office_export", "Workspace Office export writes a Host-local file."],
        ["workspace_office_import", "Workspace Office import creates a new remote Worktree Unit."],
        ["workspace_office_import", "Workspace Office import creates a new remote Worktree Unit."],
        ["workspace_office_import", "Workspace Office import creates a new remote Worktree Unit."],
        ["workspace_office_import", "Workspace Office import creates a new remote Worktree Unit."],
        ["workspace_office_export", "Workspace Office export writes a Host-local file."],
        ["workspace_office_import", "Workspace Office import creates a new remote Worktree Unit."],
        ["workspace_office_import", "Workspace Office import creates a new remote Worktree Unit."],
        ["workspace_office_import", "Workspace Office import creates a new remote Worktree Unit."],
      ].map(([toolName, reason]) => ({ reason, toolName })),
    );
    const deniedOffice = await transferContext({ filesystem: LocalFileSystem, approval: "rejected" });
    const deniedOfficeResult = await deniedOffice.childExecute("workspace_office_import", {
      source_path: "installed-office.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    });
    assert.equal(deniedOfficeResult.isError, true);
    assert.deepEqual(deniedOffice.approvals, ["workspace_office_import"]);
    assert.equal(deniedOffice.credentialReads(), 0);
    await deniedOffice.childFiber.dispose();
    await deniedOffice.child.fiber.dispose();
    const readOnlyOffice = await transferContext({
      filesystem: InstalledConfiningLocalFileSystem,
      policy: () => ({ mode: "read-only", workspaceRoot: installedCwd }),
    });
    const readOnlyOfficeResult = await readOnlyOffice.childExecute("workspace_office_export", {
      output_path: "installed-read-only-office.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    });
    assert.equal(readOnlyOfficeResult.error.info.code, "workspace-file-policy-denied");
    assert.deepEqual(readOnlyOffice.approvals, []);
    assert.equal(readOnlyOffice.credentialReads(), 0);
    await assert.rejects(readFile(join(installedCwd, "installed-read-only-office.xlsx")), { code: "ENOENT" });
    const readOnlyRenderResult = await readOnlyOffice.childExecute("workspace_screenshot", {
      output_directory: "installed-read-only-render",
      scope: "worktree",
      target: { kind: "sheet-range", range: "A1" },
      unit_id: "unit-1",
      worktree_id: "wt-1",
    });
    assert.equal(readOnlyRenderResult.error.info.code, "workspace-file-policy-denied");
    assert.deepEqual(readOnlyOffice.approvals, []);
    assert.equal(readOnlyOffice.credentialReads(), 0);
    await assert.rejects(readdir(join(installedCwd, "installed-read-only-render")), { code: "ENOENT" });
    await readOnlyOffice.childFiber.dispose();
    await readOnlyOffice.child.fiber.dispose();
    approvalSession.append("step/end", { turn: 1, step: 1 });
    approvalSession.append("turn/end", { turn: 1, reason: { kind: "completed" } });
    const installedContentCodeSentinel = "installed-content-code-sentinel";
    const installedRenderSecretSentinel = runtimeReplacementAuthenticated.payload.cookie;
    const installedRenderSecretPattern = new RegExp(RegExp.escape(installedRenderSecretSentinel), "u");
    worktreeUnits.push(unit({
      name: "Slide",
      nodeId: "slide-node",
      resourceId: "slide-resource",
      unitId: "slide-1",
      unitType: "slide",
    }));
    const agentRenderApprovalStart = approvalRequests.length;
    const agentRenderCanonicalValues = new Map();
    ctx.on("tools/post-execute", async (execution, result, next) => {
      if (
        !result.isError
        && (execution.name === "workspace_screenshot" || execution.name === "workspace_layout_lint")
      ) agentRenderCanonicalValues.set(execution.name, result.value);
      return await next();
    });
    const agentCalls = [
      {
        id: "installed-agent-invalid-unit",
        name: "workspace_unit_add",
        arguments: JSON.stringify({ worktree_id: "wt-1", resource_id: "resource-1", cookie: worktreeSentinel }),
      },
      {
        id: "installed-agent-worktree-create",
        name: "workspace_worktree_create",
        arguments: JSON.stringify({ name: "Agent Draft", scope: "user", idempotency_key: "installed-agent-worktree" }),
      },
      {
        id: "installed-agent-unit-create",
        name: "workspace_unit_create",
        arguments: JSON.stringify({ worktree_id: "wt-1", space_id: "space-1", type: "sheet", name: "Agent Sheet" }),
      },
      {
        id: "installed-agent-content-inspect",
        name: "workspace_content_inspect",
        arguments: JSON.stringify({
          scope: "worktree",
          worktree_id: "wt-1",
          unit_id: "unit-1",
          query: { kind: "worksheet-range", ranges: [{ worksheet: { index: 0 }, range: "A1" }] },
        }),
      },
      {
        id: "installed-agent-content-execute",
        name: "workspace_content_execute",
        arguments: JSON.stringify({
          worktree_id: "wt-1",
          unit_id: "unit-1",
          code: "const contentSentinel = '" + installedContentCodeSentinel
            + "'; return { installed: 'agent-content', sentinelLength: contentSentinel.length };",
        }),
      },
      {
        id: "installed-agent-screenshot",
        name: "workspace_screenshot",
        arguments: JSON.stringify({
          output_directory: "installed-agent-render",
          scope: "worktree",
          target: { kind: "sheet-range", range: "A1" },
          unit_id: "unit-1",
          worktree_id: "wt-1",
        }),
      },
      {
        id: "installed-agent-layout-lint",
        name: "workspace_layout_lint",
        arguments: JSON.stringify({ pages: [1], unit_id: "slide-1", worktree_id: "wt-1" }),
      },
      {
        id: "installed-agent-worktree-ready",
        name: "workspace_worktree_ready",
        arguments: JSON.stringify({ worktree_id: "wt-1" }),
      },
      {
        id: "installed-agent-worktree-get",
        name: "workspace_worktree_get",
        arguments: JSON.stringify({ worktree_id: "wt-1" }),
      },
      { id: "installed-agent-space-list", name: "workspace_space_list", arguments: "{}" },
      {
        id: "installed-agent-space-browse",
        name: "workspace_space_browse",
        arguments: JSON.stringify({ space_id: "space-1" }),
      },
      {
        id: "installed-agent-space-find",
        name: "workspace_space_find",
        arguments: JSON.stringify({ space_id: "space-1", query: "folder" }),
      },
      {
        id: "installed-agent-node-create",
        name: "workspace_node_create",
        arguments: JSON.stringify({ space_id: "space-1", name: "Created" }),
      },
      { id: "installed-agent-worktree-list", name: "workspace_worktree_list", arguments: "{}" },
      {
        id: "installed-agent-unit-list",
        name: "workspace_unit_list",
        arguments: JSON.stringify({ worktree_id: "wt-1" }),
      },
      {
        id: "installed-agent-review",
        name: "workspace_worktree_review_url",
        arguments: JSON.stringify({ unit_id: "unit-1", worktree_id: "wt-1" }),
      },
      {
        id: "installed-agent-office-export",
        name: "workspace_office_export",
        arguments: JSON.stringify({
          output_path: "installed-agent-office.xlsx",
          unit_id: "unit-1",
          worktree_id: "wt-1",
        }),
      },
      {
        id: "installed-agent-api-find",
        name: "workspace_api_find",
        arguments: JSON.stringify({ terms: ["setValues"], limit: 1 }),
      },
      {
        id: "installed-agent-api-show",
        name: "workspace_api_show",
        arguments: JSON.stringify({ symbols: ["DefinitelyMissingWorkspaceApiSymbol"] }),
      },
      { id: "installed-agent-resource-registries", name: "workspace_resource_registries", arguments: "{}" },
      {
        id: "installed-agent-resource-find",
        name: "workspace_resource_find",
        arguments: JSON.stringify({ queries: ["arrow"], limit: 1 }),
      },
      {
        id: "installed-agent-resource-export",
        name: "workspace_resource_export",
        arguments: JSON.stringify({
          handles: ["example-openmoji-black/1f10e"],
          output_directory: "installed-agent-discovery",
        }),
      },
      {
        id: "installed-agent-blob-get",
        name: "workspace_blob_get",
        arguments: JSON.stringify({ resource_id: "blob-resource-1" }),
      },
      {
        id: "installed-agent-blob-upload",
        name: "workspace_blob_upload",
        arguments: JSON.stringify({ source_path: "installed-upload.bin", space_id: "space-1", idempotency_key: "installed-agent-upload" }),
      },
      {
        id: "installed-agent-blob-download",
        name: "workspace_blob_download",
        arguments: JSON.stringify({ resource_id: "blob-resource-1", output_path: "installed-agent-blob.bin" }),
      },
      {
        id: "installed-agent-asset-download",
        name: "workspace_asset_download",
        arguments: JSON.stringify({ worktree_id: "wt-1", asset_id: "asset-1", output_path: "installed-agent-asset.bin" }),
      },
    ];
    class SmokeAdapter extends LlmAdapter {
      calls = 0;
      resolveModel(provider, model) {
        return Promise.resolve({ provider, id: model, name: model });
      }
      async * stream() {
        const current = agentCalls[this.calls++];
        if (current !== undefined) {
          yield { type: "block-start", index: 0, blockType: "tool-call" };
          yield {
            type: "block-end",
            index: 0,
            block: {
              type: "tool-call",
              id: CallId(current.id),
              name: current.name,
              arguments: current.arguments,
            },
          };
          yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
          yield { type: "finish", reason: { kind: "tool-calls" } };
          return;
        }
        yield { type: "block-start", index: 0, blockType: "text" };
        yield { type: "text-delta", index: 0, text: "done" };
        yield { type: "block-end", index: 0, block: { type: "text", text: "done" } };
        yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
        yield { type: "finish", reason: { kind: "stop" } };
      }
    }
    const adapter = new SmokeAdapter();
    ctx.llm.registerAdapter(["installed-smoke"], adapter);
    await ctx.plugin(AgentLoop, { agents: [] });
    const agent = ctx.agentLoop.create(SessionId("installed-dsh-univer-work"), {
      provider: "installed-smoke",
      model: "installed-smoke",
    }, { cwd: installedCwd });
    agent.followup(createUserMessage({
      content: [{ type: "text", text: "List Workspace Spaces." }],
      source: { kind: "user" },
    }));
    await agent.whenIdle();
    const agentToolCalls = agent.session.events.filter((event) => event.type === "tool/call");
    const agentToolResults = agent.session.events.filter((event) => event.type === "tool/result");
    assert.deepEqual(agentToolCalls.map((event) => event.data.name), agentCalls.map(({ name }) => name));
    assert.equal(agentToolResults.length, agentCalls.length);
    assert.match(JSON.stringify(agentToolResults[1]), /Created Workspace Worktree Agent Draft \\(wt-1\\)/);
    assert.match(JSON.stringify(agentToolResults[2]), /Agent Sheet.*unit-1/i);
    assert.match(JSON.stringify(agentToolResults[3]), /runtime-smoke/i);
    assert.match(JSON.stringify(agentToolResults[4]), /agent-content/i);
    assert.match(JSON.stringify(agentToolResults[7]), /Ready.*wt-1/i);
    assert.match(JSON.stringify(agentToolResults[8]), /wt-1.*ready/i);
    assert.deepEqual(worktreeUnits[0].target, { parentNodeId: null, spaceId: "space-1" });
    assert.match(JSON.stringify(agentToolResults[14]), /Agent Sheet.*unit-1.*worktree/i);
    assert.match(JSON.stringify(agentToolResults), /Personal.*space-1/);
    assert.match(JSON.stringify(agentToolResults), /Created.*created/);
    assert.match(JSON.stringify(agentToolResults), /wt-1.*unit-1/);
    assert.ok(JSON.stringify(agentToolResults).includes(
      ${JSON.stringify(contentRuntimeFixture.origin)} + "/worktrees?worktree=wt-1&unit=unit-1&view=agent",
    ));
    assert.match(JSON.stringify(agentToolResults[16]), /Exported sheet Unit unit-1.*installed-agent-office\.xlsx/i);
    assert.ok((await stat(join(installedCwd, "installed-agent-office.xlsx"))).size > 0);
    assert.match(JSON.stringify(agentToolResults[17]), /Found API reference matches for 1 term/i);
    assert.match(JSON.stringify(agentToolResults[18]), /Resolved 1 API symbol result/i);
    assert.match(JSON.stringify(agentToolResults[19]), /Listed [0-9]+ installed resource registries/i);
    assert.match(JSON.stringify(agentToolResults[20]), /Found 1 of [0-9]+ matching resources/i);
    assert.match(JSON.stringify(agentToolResults[21]), /Exported 1 resource file/i);
    assert.match(
      await readFile(join(installedCwd, "installed-agent-discovery", "example-openmoji-black--1f10e.svg"), "utf8"),
      /^<svg/u,
    );
    assert.match(JSON.stringify(agentToolResults.at(-4)), /blob-resource-1.*blob\.bin/i);
    assert.match(JSON.stringify(agentToolResults.at(-3)), /installed-upload\.bin.*uploaded-resource-1/i);
    assert.match(JSON.stringify(agentToolResults.at(-2)), /blob-resource-1.*installed-agent-blob\.bin/i);
    assert.match(JSON.stringify(agentToolResults.at(-1)), /asset-1.*installed-agent-asset\.bin/i);
    assert.equal(await readFile(join(installedCwd, "installed-agent-blob.bin"), "utf8"), "blob");
    assert.equal(await readFile(join(installedCwd, "installed-agent-asset.bin"), "utf8"), "asset");
    assert.deepEqual(inspectPng(await readFile(join(installedCwd, "installed-agent-render", "A1.png"))), {
      height: 48,
      width: 176,
    });
    assert.deepEqual(agentToolResults[5].data.message.content, [{
      content: [{ type: "text", text: "Captured 1 PNG file(s) for sheet Unit unit-1." }],
      isError: false,
      toolCallId: "installed-agent-screenshot",
      type: "tool-result",
    }]);
    assert.deepEqual(agentToolResults[6].data.message.content, [{
      content: [{ type: "text", text: "Layout lint found 0 issue(s) in Slide Unit slide-1." }],
      isError: false,
      toolCallId: "installed-agent-layout-lint",
      type: "tool-result",
    }]);
    assert.deepEqual(agentRenderCanonicalValues.get("workspace_screenshot"), {
      kind: "workspace-screenshot",
      outputs: [{
        height: 48,
        location: join(installedCwd, "installed-agent-render", "A1.png"),
        mediaType: "image/png",
        name: "A1.png",
        range: "A1",
        width: 176,
      }],
      unitId: "unit-1",
      unitType: "sheet",
    });
    assert.deepEqual(agentRenderCanonicalValues.get("workspace_layout_lint"), {
      coverage: {
        pages: [{ page: 1, pageId: "cover" }],
        rules: ["text-off-page", "text-escapes-container", "text-overlaps-text"],
      },
      findings: [],
      kind: "unit-layout-lint",
      unitId: "slide-1",
      unitType: "slide",
    });
    validateInstalledRenderBudget(agentRenderCanonicalValues.get("workspace_screenshot"));
    validateInstalledRenderBudget(agentRenderCanonicalValues.get("workspace_layout_lint"));
    assert.deepEqual(
      approvalRequests.slice(agentRenderApprovalStart).filter(({ toolName }) =>
        toolName === "workspace_screenshot" || toolName === "workspace_layout_lint"),
      [{
        toolName: "workspace_screenshot",
        reason: "Workspace screenshot writes PNG files to a Host-local Session directory.",
      }],
    );
    assert.equal(agentToolResults[0].data.message.content[0].isError, true);
    const unexpectedAgentErrors = agentToolResults.slice(1)
      .filter((event) => event.data.message.content[0].isError);
    assert.equal(unexpectedAgentErrors.length, 0, JSON.stringify(unexpectedAgentErrors));
    assert.match(JSON.stringify(agentToolCalls[0]), /installed-worktree-private-sentinel/);
    assert.match(JSON.stringify(agentToolCalls[4]), new RegExp(installedContentCodeSentinel));
    assert.doesNotMatch(JSON.stringify(agentToolResults), /installed-worktree-private-sentinel/);
    assert.doesNotMatch(JSON.stringify(agentToolResults), installedRenderSecretPattern);
    assert.doesNotMatch(JSON.stringify(agentToolResults), new RegExp(installedContentCodeSentinel));
    assert.equal(adapter.calls, agentCalls.length + 1);
    const nativeParityOutcomes = new Map([
      ["api-discovery", apiFind],
      ["authentication", completedAuthentication],
      ["content", contentConfirmed],
      ["file-transfer", blobGet],
      ["office", officeExport],
      ["render", installedScreenshot],
      ["resource-discovery", nativeDiscoveryExport],
      ["shell", names().length === 42],
      ["space-node", listed],
      ["svg", realSvg],
      ["typst", compiledTypst],
      ["unit-topic-skills", loadedSkill],
      ["worktree-unit", listedWorktrees],
    ]);
    assert.deepEqual([...nativeParityOutcomes.keys()].sort(), expectedParityOutcomeIds);
    for (const [id, result] of nativeParityOutcomes) {
      assert.ok(expectedParityCaseIds.includes(id + ".installed.native"));
      if (id === "shell") assert.equal(result, true);
      else assert.equal(result.isError, false, "Native parity outcome failed: " + id);
    }

    class InstalledCodeRuntime extends CodeRuntime {
      isolation = "installed-smoke";
      language = "typescript";
      dispatches = [];
      async run(request) {
        const tools = request.bindings.find(({ global }) => global === "tools")?.functions;
        assert.ok(tools);
        const value = [];
        for (const dispatch of this.dispatches) {
          try {
            value.push(await tools[dispatch.name](dispatch.arguments));
          } catch (error) {
            value.push({ error: error instanceof Error ? error.message : "tool failed" });
          }
        }
        return { logs: [], value };
      }
    }
    await mkdir(join(installedCwd, "installed-code-typst-bundle", "pages"), { recursive: true });
    await writeFile(
      join(installedCwd, "installed-code-typst-bundle", "pages", "one.typ"),
      "= Installed Code Typst\\n\\nHello from the packed native compiler.",
    );
    await writeFile(join(installedCwd, "installed-code-typst-bundle", "typst.json"), JSON.stringify({
      pages: ["pages/one.typ"],
      schemaVersion: 1,
      targetUnitId: "installed-code-typst-doc",
      title: "Installed Code Typst",
    }));
    await mkdir(join(installedCwd, "installed-code-svg", "assets"), { recursive: true });
    await writeFile(
      join(installedCwd, "installed-code-svg", "page.svg"),
      '<svg viewBox="0 0 320 180"><image href="assets/pixel.png" width="1" height="1"/><text x="12" y="36">Installed Code SVG</text></svg>',
    );
    await writeFile(
      join(installedCwd, "installed-code-svg", "assets", "pixel.png"),
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2NDNwAAAABJRU5ErkJggg==", "base64"),
    );
    codeCtx = new Context();
    await codeCtx.plugin(SystemPrompt, { persona: "" });
    await codeCtx.plugin(InstalledCodeRuntime);
    await codeCtx.plugin(ToolRuntime, { mode: "code" });
    await codeCtx.plugin(SkillRegistry);
    let codeSkillProviderRegistrations = 0;
    const registerCodeSkillProvider = codeCtx.skills.registerProvider.bind(codeCtx.skills);
    codeCtx.skills.registerProvider = (create) => {
      codeSkillProviderRegistrations += 1;
      return registerCodeSkillProvider(create);
    };
    await codeCtx.plugin(FileSystemSkill, {
      agentsHome: isolatedAgentsSkillHome,
      dshHome: isolatedDshSkillHome,
      watch: false,
    });
    const codeSkillProviderBaseline = codeSkillProviderRegistrations;
    codeCtx.provide("agents", {});
    await codeCtx.plugin(ToolSkill);
    await codeCtx.plugin(ApprovalService);
    await codeCtx.plugin(LocalFileSystem, { cwd: ${JSON.stringify(profileRoot)} });
    let codeCredentialReads = 0;
    codeCtx.provide("credentials", {
      async readRecord() { codeCredentialReads += 1; return storedRecord; },
      async modifyRecord(_key, mutate) {
        const next = await mutate(storedRecord);
        if (next !== undefined) storedRecord = next;
        return storedRecord;
      },
      async deleteRecord() { storedRecord = undefined; },
    });
    const codeApprovals = [];
    codeCtx.on("approval/request", (request) => {
      codeApprovals.push(request.toolName);
      return Promise.resolve("allowed-once");
    });
    const codeFiber = codeCtx.plugin(plugin);
    await codeFiber;
    assert.equal(codeSkillProviderRegistrations, codeSkillProviderBaseline,
      "dsh-univer-work added a Code Mode Skill provider/root/watcher owner");
    storedRecord = undefined;
    codeCtx.codeRuntime.dispatches = [{
      name: "workspace_auth_start",
      arguments: { origin: ${JSON.stringify(contentRuntimeFixture.origin)} },
    }, {
      name: "workspace_auth_complete",
      arguments: {},
    }];
    const codeAuthSessionId = SessionId("installed-code-mode-auth");
    const codeAuthSession = Session.create(codeAuthSessionId, [], {
      version: 0,
      id: codeAuthSessionId,
      createdAt: 0,
      cwd: installedCwd,
    });
    codeAuthSession.append("turn/start", { turn: 1 });
    codeAuthSession.append("step/start", { turn: 1, step: 1 });
    const codeAuthResult = await codeCtx.tools.execute({
      arguments: { code: "return await authenticateWorkspace();", description: "Exercise installed authentication handoff" },
      callId: CallId("installed-code-mode-auth"),
      name: "run_code",
      signal: new AbortController().signal,
      agent: { session: codeAuthSession },
    });
    assert.equal(codeAuthResult.isError, false, JSON.stringify(codeAuthResult));
    assert.equal(codeAuthResult.value.result[0].status, "authorization_required");
    assert.equal(codeAuthResult.value.result[0].origin, ${JSON.stringify(contentRuntimeFixture.origin)});
    assert.deepEqual(codeAuthResult.value.result[1], {
      origin: ${JSON.stringify(contentRuntimeFixture.origin)},
      status: "authenticated",
      subject: { id: "user-1", name: "Installed User" },
    });
    assert.deepEqual(storedRecord, runtimeAuthenticated);
    assert.equal(codeAuthSession.events.filter(({ type }) => type === "tool/code-dispatch-start").length, 2);
    assert.equal(codeAuthSession.events.filter(({ type }) => type === "tool/code-dispatch").length, 2);
    currentWorktreeState = "draft";
    currentDraftRevision = 1;
    worktreeUnits[0].draftHeadRevision = currentDraftRevision;
    codeCtx.codeRuntime.dispatches = [
      {
        name: "workspace_unit_create",
        arguments: { worktree_id: "wt-1", space_id: "space-1", type: "sheet", name: "Draft", initial_data: worktreeSentinel },
      },
      { name: "workspace_worktree_list", arguments: {} },
      {
        name: "workspace_content_inspect",
        arguments: {
          scope: "worktree",
          worktree_id: "wt-1",
          unit_id: "unit-1",
          query: { kind: "worksheet-range", ranges: [{ worksheet: { index: 0 }, range: "A1" }] },
        },
      },
      {
        name: "workspace_content_execute",
        arguments: {
          worktree_id: "wt-1",
          unit_id: "unit-1",
          code: "const contentSentinel = '" + installedContentCodeSentinel
            + "'; return { installed: 'code-content', sentinelLength: contentSentinel.length };",
        },
      },
      {
        name: "workspace_screenshot",
        arguments: {
          output_directory: "installed-code-render",
          scope: "worktree",
          target: { kind: "sheet-range", range: "A1" },
          unit_id: "unit-1",
          worktree_id: "wt-1",
        },
      },
      {
        name: "workspace_layout_lint",
        arguments: { pages: [1], unit_id: "slide-1", worktree_id: "wt-1" },
      },
      {
        name: "workspace_office_export",
        arguments: {
          output_path: "installed-code-office.xlsx",
          unit_id: "unit-1",
          worktree_id: "wt-1",
        },
      },
      { name: "workspace_api_find", arguments: { terms: ["setValues"], limit: 1 } },
      { name: "workspace_api_show", arguments: { symbols: ["DefinitelyMissingWorkspaceApiSymbol"] } },
      { name: "workspace_resource_registries", arguments: {} },
      { name: "workspace_resource_find", arguments: { queries: ["arrow"], limit: 1 } },
      {
        name: "workspace_resource_export",
        arguments: {
          handles: ["example-openmoji-black/1f10e"],
          output_directory: "installed-code-discovery",
        },
      },
      { name: "workspace_blob_get", arguments: { resource_id: "blob-resource-1" } },
      { name: "workspace_blob_upload", arguments: { source_path: "installed-upload.bin", space_id: "space-1", idempotency_key: "installed-code-upload" } },
      { name: "workspace_blob_download", arguments: { resource_id: "blob-resource-1", output_path: "installed-code-blob.bin" } },
      { name: "workspace_asset_download", arguments: { worktree_id: "wt-1", asset_id: "asset-1", output_path: "installed-code-asset.bin" } },
      { name: "workspace_auth_whoami", arguments: {} },
      { name: "workspace_space_list", arguments: {} },
      {
        name: "workspace_typst_compile",
        arguments: {
          artifact_directory: "installed-code-typst-artifacts",
          bundle_path: "installed-code-typst-bundle",
        },
      },
      {
        name: "workspace_svg_compile",
        arguments: { page: 1, source_path: "installed-code-svg/page.svg" },
      },
    ];
    const codeSessionId = SessionId("installed-code-mode");
    const codeSession = Session.create(codeSessionId, [], {
      version: 0,
      id: codeSessionId,
      createdAt: 0,
      cwd: installedCwd,
    });
    codeSession.append("turn/start", { turn: 1 });
    codeSession.append("step/start", { turn: 1, step: 1 });
    const codeResult = await codeCtx.tools.execute({
      arguments: { code: "return await exerciseWorkspace();", description: "Exercise installed Worktree tools" },
      callId: CallId("installed-code-mode"),
      name: "run_code",
      signal: new AbortController().signal,
      agent: { session: codeSession },
    });
    assert.equal(codeResult.isError, false, JSON.stringify(codeResult));
    const codeStarts = codeSession.events.filter(({ type }) => type === "tool/code-dispatch-start");
    const codeSettles = codeSession.events.filter(({ type }) => type === "tool/code-dispatch");
    assert.equal(codeStarts.length, 20);
    assert.equal(codeSettles.length, 20);
    assert.deepEqual(
      codeSettles.map(({ data }) => ({ name: data.name, subCallId: data.subCallId })),
      codeStarts.map(({ data }) => ({ name: data.name, subCallId: data.subCallId })),
    );
    assert.match(JSON.stringify(codeStarts[0].data.arguments), /installed-worktree-private-sentinel/);
    assert.match(JSON.stringify(codeSettles[0].data.arguments), /installed-worktree-private-sentinel/);
    assert.match(JSON.stringify(codeStarts[3].data.arguments), new RegExp(installedContentCodeSentinel));
    assert.match(JSON.stringify(codeSettles[3].data.arguments), new RegExp(installedContentCodeSentinel));
    assert.equal(codeSettles[0].data.isError, true);
    assert.equal(codeSettles[1].data.isError, false);
    assert.equal(codeSettles.slice(2).every(({ data }) => data.isError === false), true);
    assert.deepEqual(codeApprovals, [
      "workspace_content_execute",
      "workspace_screenshot",
      "workspace_office_export",
      "workspace_resource_export",
      "workspace_blob_upload",
      "workspace_blob_download",
      "workspace_asset_download",
      "workspace_typst_compile",
    ]);
    assert.equal(codeResult.value.result[2].ranges[0].displayValues[0][0], "runtime-smoke");
    assert.deepEqual(codeResult.value.result[3], {
      committed: false,
      value: { installed: "code-content", sentinelLength: installedContentCodeSentinel.length },
    });
    assert.deepEqual(codeResult.value.result[4], {
      kind: "workspace-screenshot",
      outputs: [{
        height: 48,
        location: join(installedCwd, "installed-code-render", "A1.png"),
        mediaType: "image/png",
        name: "A1.png",
        range: "A1",
        width: 176,
      }],
      unitId: "unit-1",
      unitType: "sheet",
    });
    assert.deepEqual(codeResult.value.result[5], {
      coverage: {
        pages: [{ page: 1, pageId: "cover" }],
        rules: ["text-off-page", "text-escapes-container", "text-overlaps-text"],
      },
      findings: [],
      kind: "unit-layout-lint",
      unitId: "slide-1",
      unitType: "slide",
    });
    validateInstalledRenderBudget(codeResult.value.result[4]);
    validateInstalledRenderBudget(codeResult.value.result[5]);
    assert.deepEqual(inspectPng(await readFile(codeResult.value.result[4].outputs[0].location)), {
      height: 48,
      width: 176,
    });
    assert.equal(codeResult.value.result[6].type, "sheet");
    assert.equal(codeResult.value.result[6].outputPath.endsWith("/installed-code-office.xlsx"), true);
    assert.ok((await stat(join(installedCwd, "installed-code-office.xlsx"))).size > 0);
    assert.equal(codeResult.value.result[7].terms[0].term, "setValues");
    assert.equal(codeResult.value.result[8].results[0].status, "not-found");
    assert.ok(codeResult.value.result[9].registries.length > 0);
    assert.equal(codeResult.value.result[10].resources.length, 1);
    assert.deepEqual(codeResult.value.result[11], {
      complete: true,
      exported: [{
        handle: "example-openmoji-black/1f10e",
        path: join(installedCwd, "installed-code-discovery", "example-openmoji-black--1f10e.svg"),
      }],
      failed: [],
    });
    assert.equal(codeResult.value.result[12].resource.resourceId, "blob-resource-1");
    assert.equal(codeResult.value.result[13].upload.uploadId, "blob-upload-1");
    assert.equal(codeResult.value.result[14].download.resourceId, "blob-resource-1");
    assert.equal(codeResult.value.result[15].download.assetId, "asset-1");
    assert.deepEqual(codeResult.value.result[16], {
      status: "authenticated",
      subject: { id: "user-1", name: "Installed User" },
    });
    assert.deepEqual(codeResult.value.result[17], {
      spaces: [{ id: "space-1", name: "Personal", type: "personal" }],
    });
    assert.equal(codeResult.value.result[18].committed, false);
    assert.equal(codeResult.value.result[18].targetUnitId, "installed-code-typst-doc");
    assert.equal(codeResult.value.result[18].artifactDirectory, "installed-code-typst-artifacts");
    assert.equal(codeResult.value.result[19].textMeasure, "univer-render-runtime");
    assert.match(codeResult.value.result[19].generated.code, /presentation\.appendSlide\(\)/u);
    assert.match(
      await readFile(join(installedCwd, "installed-code-discovery", "example-openmoji-black--1f10e.svg"), "utf8"),
      /^<svg/u,
    );
    assert.equal(await readFile(join(installedCwd, "installed-code-blob.bin"), "utf8"), "blob");
    assert.equal(await readFile(join(installedCwd, "installed-code-asset.bin"), "utf8"), "asset");
    assert.ok((await stat(join(installedCwd, "installed-code-typst-artifacts", "program.js"))).size > 0);
    const codeSkillCredentialBaseline = codeCredentialReads;
    const codeSkillApprovalBaseline = codeApprovals.length;
    const codeSkillRequestBaseline = allFetchRequests.length;
    const codeSkillBrowserBaseline = renderBrowserProcesses();
    const codeSkillNames = ["core", ...bundledSkillNames];
    codeCtx.codeRuntime.dispatches = codeSkillNames.map((name) => ({
      name: "skill",
      arguments: { name },
    }));
    const codeSkillSessionId = SessionId("installed-code-mode-skills");
    const codeSkillSession = Session.create(codeSkillSessionId, [], {
      version: 0,
      id: codeSkillSessionId,
      createdAt: 0,
      cwd: isolatedSkillProject,
    });
    codeSkillSession.append("turn/start", { turn: 1 });
    codeSkillSession.append("step/start", { turn: 1, step: 1 });
    const codeSkillResult = await codeCtx.tools.execute({
      arguments: { code: "return await loadBundledWorkspaceSkills();", description: "Load installed bundled Skills" },
      callId: CallId("installed-code-mode-skills"),
      name: "run_code",
      signal: new AbortController().signal,
      agent: { session: codeSkillSession },
    });
    assert.equal(codeSkillResult.isError, false, JSON.stringify(codeSkillResult));
    assert.equal(codeSkillResult.value.result.length, codeSkillNames.length);
    for (let index = 0; index < codeSkillNames.length; index += 1) {
      const name = codeSkillNames[index];
      const packedSource = await readFile(
        new URL("../skills/" + name + "/SKILL.md", pathToFileURL(require.resolve("dsh-univer-work"))),
        "utf8",
      );
      assert.deepEqual(codeSkillResult.value.result[index], {
        name,
        provider: "runtime",
        content: name === "core" ? packedSource : parsePackedSkill(name, packedSource).content,
      });
    }
    assert.equal(codeSkillSession.events.filter(({ type }) => type === "tool/code-dispatch-start").length, 8);
    assert.equal(codeSkillSession.events.filter(({ type }) => type === "tool/code-dispatch").length, 8);
    assert.equal(codeCredentialReads, codeSkillCredentialBaseline);
    assert.equal(codeApprovals.length, codeSkillApprovalBaseline);
    assert.equal(allFetchRequests.length, codeSkillRequestBaseline);
    assert.deepEqual(newProcessIdentities(renderBrowserProcesses(), codeSkillBrowserBaseline), new Set());
    assert.equal(codeSkillProviderRegistrations, codeSkillProviderBaseline);
    const codeParityOutcomes = new Map([
      ["api-discovery", codeResult.value.result[7]],
      ["authentication", codeAuthResult.value.result[1]],
      ["content", codeResult.value.result[3]],
      ["file-transfer", codeResult.value.result[12]],
      ["office", codeResult.value.result[6]],
      ["render", codeResult.value.result[4]],
      ["resource-discovery", codeResult.value.result[11]],
      ["shell", codeCtx.tools.schemas().filter(({ name }) => name.startsWith("workspace_")).length === 42],
      ["space-node", codeResult.value.result[17]],
      ["svg", codeResult.value.result[19]],
      ["typst", codeResult.value.result[18]],
      ["unit-topic-skills", codeSkillResult.value.result[0]],
      ["worktree-unit", codeResult.value.result[1]],
    ]);
    assert.deepEqual([...codeParityOutcomes.keys()].sort(), expectedParityOutcomeIds);
    for (const [id, result] of codeParityOutcomes) {
      assert.ok(expectedParityCaseIds.includes(id + ".installed.code"));
      if (id === "shell") assert.equal(result, true);
      else {
        assert.notEqual(result, undefined, "Code Mode parity outcome missing: " + id);
        assert.equal(
          result !== null && typeof result === "object" && "error" in result,
          false,
          "Code Mode parity outcome failed: " + id,
        );
      }
    }
    const codeRenderProjection = JSON.stringify({
      codeResult,
      events: codeSession.events.map((event) => {
        if (event.type === "tool/code-dispatch-start" || event.type === "tool/code-dispatch") {
          const { arguments: _arguments, ...data } = event.data;
          return { ...event, data };
        }
        return event;
      }),
    });
    assert.doesNotMatch(codeRenderProjection, /installed-worktree-private-sentinel|installed-content-code-sentinel/);
    assert.doesNotMatch(codeRenderProjection, installedRenderSecretPattern);
    await codeFiber.dispose();
    for (const name of bundledSkillNames) assert.equal(await codeCtx.skills.get(name), undefined);
    await codeCtx.fiber.dispose();

    const withoutDshArguments = (event) => {
      if (
        event.type === "tool/call"
        || event.type === "tool/code-dispatch-start"
        || event.type === "tool/code-dispatch"
      ) {
        const { arguments: _arguments, ...data } = event.data;
        return { ...event, data };
      }
      if (event.type === "assistant/chunk" && event.data.chunk.type === "block-end" && event.data.chunk.block.type === "tool-call") {
        const { arguments: _arguments, ...block } = event.data.chunk.block;
        return { ...event, data: { ...event.data, chunk: { ...event.data.chunk, block } } };
      }
      if (event.type === "assistant/message") {
        return {
          ...event,
          data: {
            ...event.data,
            message: {
              ...event.data.message,
              content: event.data.message.content.map((block) => block.type === "tool-call"
                ? (({ arguments: _arguments, ...rest }) => rest)(block)
                : block),
            },
          },
        };
      }
      return event;
    };
    const keylessTranscript = JSON.stringify({
      approvalEvents: approvalSession.events.map(withoutDshArguments),
      approvalRequests,
      agentEvents: agent.session.events.map(withoutDshArguments),
      codeEvents: codeSession.events.map(withoutDshArguments),
      results: [
        invalid,
        closedTransfer,
        noClobber,
        cancelledUpload,
        invalidWorktree,
        listed,
        listedWorktrees,
        created,
        createdWorktree,
        createdUnit,
        ready,
        review,
        unknownWorktree,
        allowedFailure,
        hiddenFailure,
        cancelledResult,
        lateResult,
        unknown,
        officeExport,
        officeImport,
        officeNoClobber,
        officeRevisionMismatch,
        officeOutcomeResults,
      ],
      excludedDshArgumentFields: [
        "tool/call.arguments",
        "tool/code-dispatch-start.arguments",
        "tool/code-dispatch.arguments",
      ],
    });
    assert.match(keylessTranscript, /workspace_space_browse.*workspace_space_find.*Never replay/i);
    assert.match(keylessTranscript, /installed-cancelled-key.*Never retry the upload automatically/i);
    assert.doesNotMatch(keylessTranscript, /installed-invalid-cookie-sentinel|installed-transfer-secret|installed-transfer-password-cookie-sentinel|installed-worktree-private-sentinel|installed-content-code-sentinel|installed-office-(?:caller|create|invalid)-secret|installed-typst-(?:license|http|started-cancel)-secret|installed-private-code|installed private abort/);
    assert.doesNotMatch(keylessTranscript, installedRenderSecretPattern);

    mode = "dispose-combined";
    transferStreamEntered = Promise.withResolvers();
    transferStreamCancelled = Promise.withResolvers();
    releaseTransferStream = Promise.withResolvers();
    discoveryRequestEntered = Promise.withResolvers();
    officeCreateEntered = Promise.withResolvers();
    releaseOfficeCreate = Promise.withResolvers();
    const disposeSessionId = SessionId("installed-transfer-dispose");
    const disposeSession = Session.create(disposeSessionId, [], {
      version: 0,
      id: disposeSessionId,
      createdAt: 0,
      cwd: installedCwd,
    });
    disposeSession.append("turn/start", { turn: 1 });
    disposeSession.append("step/start", { turn: 1, step: 1 });
    const ownerStopped = execute(
      "workspace_blob_download",
      { resource_id: "blob-resource-1", output_path: "installed-disposing.bin" },
      { agent: { session: disposeSession } },
    );
    const discoveryOwnerStopped = execute(
      "workspace_resource_export",
      {
        handles: ["example-openmoji-color/1f10e"],
        output_directory: "installed-discovery-disposing",
      },
      { agent: { session: disposeSession } },
    );
    const officeOwnerStopped = execute(
      "workspace_office_import",
      {
        source_path: "installed-office.xlsx",
        space_id: "space-1",
        worktree_id: "wt-1",
      },
      { agent: { session: disposeSession } },
    );
    storedRecord = runtimeAuthenticated;
    ctx.emit("credentials/record-updated", "dsh-univer-work/workspace");
    worktreeUnits.push(unit({
      name: "Slide",
      nodeId: "slide-node",
      resourceId: "slide-resource",
      unitId: "slide-1",
      unitType: "slide",
    }));
    const renderProbeBaseline = allFetchRequests.filter((entry) =>
      entry.endsWith("/api/worktrees/wt-1")).length;
    const renderOwnerStopped = execute("workspace_screenshot", {
      output_directory: "installed-render-disposing",
      scope: "worktree",
      target: { kind: "slide-pages", pages: Array.from({ length: 10 }, (_, index) => index + 1) },
      unit_id: "slide-1",
      worktree_id: "wt-1",
    }, { agent: { session: disposeSession } });
    const renderProbeDeadline = Date.now() + 10_000;
    while (allFetchRequests.filter((entry) => entry.endsWith("/api/worktrees/wt-1")).length
      === renderProbeBaseline) {
      if (Date.now() >= renderProbeDeadline) throw new Error("disposing render did not probe target");
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await transferStreamEntered.promise;
    await discoveryRequestEntered.promise;
    await officeCreateEntered.promise;
    let disposed = false;
    const disposal = fiber.dispose().then(() => { disposed = true; });
    await transferStreamCancelled.promise;
    assert.deepEqual(names(), []);
    assert.equal(disposed, false);
    releaseTransferStream.resolve();
    releaseOfficeCreate.resolve();
    assert.equal((await ownerStopped).error.info.code, "workspace-plugin-disposing");
    assert.equal((await discoveryOwnerStopped).error.info.code, "workspace-plugin-disposing");
    assert.equal((await renderOwnerStopped).error.info.code, "workspace-plugin-disposing");
    const officeOwnerConfirmed = await officeOwnerStopped;
    assert.equal(officeOwnerConfirmed.isError, false, JSON.stringify(officeOwnerConfirmed));
    assert.equal(officeOwnerConfirmed.value.committed, true);
    let disposalTimer;
    const disposedWithinBound = await Promise.race([
      disposal.then(() => true),
      new Promise((resolve) => { disposalTimer = setTimeout(() => resolve(false), 10_000); }),
    ]);
    clearTimeout(disposalTimer);
    assert.equal(disposedWithinBound, true, "render owner disposal exceeded 10 seconds");
    assert.deepEqual((await readdir(installedCwd)).filter((name) => name.endsWith(".tmp")), []);
    await assert.rejects(readFile(join(installedCwd, "installed-disposing.bin")), { code: "ENOENT" });
    await assert.rejects(readdir(join(installedCwd, "installed-discovery-disposing")), { code: "ENOENT" });
    await assert.rejects(readdir(join(installedCwd, "installed-render-disposing")), { code: "ENOENT" });
    assert.deepEqual(names(), []);
    assert.equal(await ctx.skills.get("core"), undefined);
    for (const name of bundledSkillNames) assert.equal(await ctx.skills.get(name), undefined);
    assert.equal(credentialMutations, 0, "credential mutation survived first disposal");
    assert.deepEqual(storedRecord, runtimeAuthenticated,
      "plugin disposal removed the persistent owner GrantRecord");
    await settleLifecycleAudit(lifecycleBaseline, "installed cycle 1 disposal");

    mode = "normal";
    const completeToolNames = names;
    for (const cycle of [2, 3]) {
      const cycleFiber = ctx.plugin(plugin);
      await cycleFiber;
      assert.equal(completeToolNames().length, 42, "installed cycle " + cycle + " tool total");
      assert.equal((await ctx.skills.list({ cwd: installedCwd })).filter(({ name }) =>
        name === "core" || bundledSkillNames.includes(name)).length, 8,
      "installed cycle " + cycle + " Skill total");
      assert.deepEqual(storedRecord, runtimeAuthenticated,
        "installed cycle " + cycle + " did not retain the owner GrantRecord");
      const cycleWhoami = await execute("workspace_auth_whoami", {});
      assert.deepEqual(cycleWhoami.value, {
        status: "authenticated",
        subject: { id: "user-1", name: "Installed User" },
      });
      if (cycle === 3) {
        const logoutSessionId = SessionId("installed-cycle-3-logout");
        const logoutSession = Session.create(logoutSessionId, [], {
          version: 0,
          id: logoutSessionId,
          createdAt: 0,
          cwd: installedCwd,
        });
        logoutSession.append("turn/start", { turn: 1 });
        logoutSession.append("step/start", { turn: 1, step: 1 });
        const logout = await execute("workspace_auth_logout", {}, { agent: { session: logoutSession } });
        assert.equal(logout.isError, false, JSON.stringify(logout));
        assert.equal(logout.value.status, "local_credentials_cleared");
        assert.equal(storedRecord, undefined, "logout did not remove the owner GrantRecord");
        logoutSession.append("step/end", { turn: 1, step: 1 });
        logoutSession.append("turn/end", { turn: 1, reason: { kind: "completed" } });
      }
      await cycleFiber.dispose();
      assert.deepEqual(names(), []);
      assert.equal(await ctx.skills.get("core"), undefined);
      for (const name of bundledSkillNames) assert.equal(await ctx.skills.get(name), undefined);
      assert.equal(credentialMutations, 0, "credential mutation survived cycle " + cycle);
      if (cycle === 2) assert.deepEqual(storedRecord, runtimeAuthenticated,
        "cycle 2 disposal removed the persistent owner GrantRecord");
      await settleLifecycleAudit(lifecycleBaseline, "installed cycle " + cycle + " disposal");
    }
    process.off("unhandledRejection", recordUnhandledRejection);
    await ctx.fiber.dispose();
    } finally {
      let cleanupError;
      for (const context of [codeCtx, ctx, typstCtx, svgCtx]) {
        try {
          await context?.fiber.dispose();
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (cleanupError !== undefined) throw cleanupError;
    }
  `;
  assert.doesNotMatch(
    script,
    /apps\/cli\/src|packages\/client-core\/(?:src|dist)|@univerjs\/univer-workspace-client-core\/(?:src|dist)/u,
    "installed parity corpus imports a forbidden checkout-only implementation path",
  );
  const scriptPath = join(runCwd, "installed-smoke.mjs");
  await writeFile(scriptPath, script);
  await run(process.execPath, [scriptPath], {
    cwd: runCwd,
    env,
    timeoutMs: 150_000,
  });
}

let root;
let runCwd;
let contentRuntimeFixture;
let discoveryHttpsFixture;
let home;
let env;
const profile = "web";
let host;
let hostClosed;
let failure;

try {
  root = await mkdtemp(join(tmpdir(), "dsh-univer-work-smoke-"));
  runCwd = await mkdtemp(join(tmpdir(), "dsh-univer-work-run-"));
  contentRuntimeFixture = await startContentRuntimeFixture();
  discoveryHttpsFixture = await startDiscoveryHttpsFixture();
  const discoveryCaPath = join(root, "discovery-smoke-ca.pem");
  await writeFile(discoveryCaPath, discoveryTlsCertificate);
  home = join(root, "home");
  env = {
    ...process.env,
    CI: "1",
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: "1",
    NODE_PATH: "",
    NODE_EXTRA_CA_CERTS: discoveryCaPath,
    npm_config_ignore_scripts: "true",
    UNIVER_LICENSE: "installed-typst-license-sentinel",
    UNIVER_RENDER_BROWSER: testBrowser,
  };
  const packed = await run(process.execPath, [pnpmBin, "pack", "--json", "--pack-destination", root], {
    cwd: new URL("..", import.meta.url),
    env,
  });
  const packSummary = JSON.parse(packed.stdout);
  const tarball = join(root, basename(packSummary.filename));
  const tarballHash = createHash("sha256").update(await readFile(tarball)).digest("hex");

  await run(process.execPath, [dshBin, "plugin", "--profile", profile, "add", tarball], { env });
  assert.equal(createHash("sha256").update(await readFile(tarball)).digest("hex"), tarballHash,
    "the prebuilt tarball changed during installation");

  if (process.env.DSH_UNIVER_WORK_SMOKE_OFFLINE_PLATFORM === "1") {
    const profileRoot = join(home, "profiles", profile);
    const profileRequire = createRequire(join(profileRoot, "package.json"));
    const suffix = {
      darwin: { arm64: "-darwin-arm64", x64: "-darwin-x64" },
      linux: { arm64: "-linux-arm64-gnu", x64: "-linux-x64-gnu" },
      win32: { x64: "-win32-x64-msvc" },
    }[process.platform]?.[process.arch];
    assert.ok(suffix, `unsupported offline smoke platform ${process.platform}/${process.arch}`);
    const platformDependencies = [];
    const nativeOwners = Object.keys(sourceManifest.dependencies ?? {})
      .filter((dependency) => dependency.endsWith("-binding"));
    assert.equal(nativeOwners.length, 3, "expected three installed native platform owners");
    for (const dependency of nativeOwners) {
      let directory = dirname(profileRequire.resolve(dependency));
      for (;;) {
        const candidate = join(directory, "package.json");
        try {
          const owner = JSON.parse(await readFile(candidate, "utf8"));
          if (owner.name === dependency) {
            const matches = Object.entries(owner.optionalDependencies ?? {})
              .filter(([name]) => name.endsWith(suffix));
            assert.ok(matches.length <= 1, `${dependency} has multiple platform packages for ${suffix}`);
            if (matches.length === 1) {
              const [[name, version]] = matches;
              assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
              platformDependencies.push(`${name}@${version}`);
            }
            break;
          }
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        const parent = dirname(directory);
        if (parent === directory) throw new Error(`missing installed package ${dependency}`);
        directory = parent;
      }
    }
    assert.equal(platformDependencies.length, 3, "expected three installed native platform owners");
    await run(process.execPath, [pnpmBin, "add", "--save-prod", ...platformDependencies], {
      cwd: profileRoot,
      env,
    });
  }

  const profileManifest = JSON.parse(
    await readFile(join(home, "profiles", profile, "package.json"), "utf8"),
  );
  assert.deepEqual(profileManifest.dsh.profile.bundles, [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-web-app",
    "dsh-univer-work",
  ]);

  const dumped = await run(process.execPath, [dshBin, "--profile", profile, "--dump-config"], {
    env,
    timeoutMs: 30_000,
  });
  assert.match(dumped.stdout, /^# == dsh-univer-work$/m);
  assert.equal(dumped.stdout.match(/^\s*- id: dsh-univer-work$/gm)?.length, 1);
  assert.equal(dumped.stdout.match(/^\s+name: dsh-univer-work$/gm)?.length, 1);

  try {
    await smokeInstalledTools(
      join(home, "profiles", profile),
      runCwd,
      env,
      contentRuntimeFixture,
      discoveryHttpsFixture,
    );
    assert.ok(discoveryHttpsFixture.requests.length >= 1, "installed discovery made no controlled HTTPS requests");
    assert.equal(discoveryHttpsFixture.requests.every(({ authorization, cookie }) =>
      authorization === null && cookie === null), true);
    assert.equal(contentRuntimeFixture.submissions(), 2, "installed content execute replayed a dispatched commit");
    assert.equal(contentRuntimeFixture.svgSubmissions(), 3, "installed SVG apply replayed a dispatched commit");
    const workerRequests = contentRuntimeFixture.requests.filter(({ role }) => role === "worker");
    assert.deepEqual(
      new Set(workerRequests.map(({ cookie }) => cookie)),
      new Set([contentRuntimeFixture.cookie, contentRuntimeFixture.replacementCookie]),
    );
    assert.ok(
      new Set(workerRequests.map(({ workerPid }) => workerPid).filter(Boolean)).size >= 2,
      "credential replacement did not create a new installed content worker",
    );
    const workerPids = contentWorkerPids(contentRuntimeFixture);
    assert.ok(workerPids.length >= 2, "installed content worker identities were not observed");
    assert.equal(await waitForProcessesToExit(workerPids, shutdownTimeoutMs), true,
      `installed content workers survived normal plugin disposal: ${workerPids.join(", ")}`);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nruntime paths: ${JSON.stringify([
        ...contentRuntimeFixture.events,
        ...contentRuntimeFixture.requests.map(({ path }) => path),
      ])}`,
    );
  }

  const port = await reservePort();
  const readyLine = `dsh web: http://127.0.0.1:${port}`;
  host = spawn(
    process.execPath,
    [dshBin, "--profile", profile, "--host", "127.0.0.1", "--port", String(port), "--no-open"],
    { detached: process.platform !== "win32", env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const running = watchHost(host, readyLine);
  hostClosed = running.closed;
  await running.ready;
  const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(response.ok, true, `Host returned HTTP ${response.status}`);

  assert.equal(host.kill("SIGTERM"), true, diagnostics("failed to request normal Host termination", ...Object.values(running.output())));
  let result = await waitWithin(running.closed, shutdownTimeoutMs);
  if (result === timedOut) {
    const deadlineError = new Error(
      diagnostics("Host shutdown deadline exceeded", ...Object.values(running.output())),
    );
    await killAndReap(host, running.closed);
    throw deadlineError;
  }
  assert.deepEqual(
    { code: result.code, signal: result.signal },
    { code: 0, signal: null },
    diagnostics("Host did not terminate normally", result.stdout, result.stderr),
  );
  host = undefined;
  hostClosed = undefined;

  console.log(`smoke passed: ${readyLine}; bundles=${profileManifest.dsh.profile.bundles.join(",")}`);
} catch (error) {
  failure = error;
}

try {
  if (host && hostClosed) await killAndReap(host, hostClosed);
} catch (error) {
  failure = failure ? new AggregateError([failure, error], "smoke and child cleanup failed") : error;
}

if (failure) {
  try {
    if (contentRuntimeFixture !== undefined) {
      await terminateFixtureWorkers(contentWorkerPids(contentRuntimeFixture));
    }
  } catch (error) {
    failure = new AggregateError([failure, error], "smoke and content-worker cleanup failed");
  }
}

try {
  await contentRuntimeFixture?.close();
} catch (error) {
  failure = failure ? new AggregateError([failure, error], "smoke and runtime fixture cleanup failed") : error;
}

try {
  await discoveryHttpsFixture?.close();
} catch (error) {
  failure = failure ? new AggregateError([failure, error], "smoke and discovery HTTPS cleanup failed") : error;
}

try {
  if (root !== undefined) await rm(root, { force: true, recursive: true });
} catch (error) {
  failure = failure ? new AggregateError([failure, error], "smoke and temporary-root cleanup failed") : error;
}

try {
  if (runCwd !== undefined) await rm(runCwd, { force: true, recursive: true });
} catch (error) {
  failure = failure ? new AggregateError([failure, error], "smoke and run-cwd cleanup failed") : error;
}

try {
  assert.deepEqual(
    root === undefined ? new Set() : installedContentWorkerProcessSet(root),
    new Set(),
    "installed content workers from this smoke root survived cleanup",
  );
} catch (error) {
  failure = failure ? new AggregateError([failure, error], "smoke and process cleanup failed") : error;
}

if (failure) throw failure;
