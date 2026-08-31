import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDaemonClient, createDaemonControl } from "@univer-cli/daemon";
import {
  transformSlideDataToSnapshot,
  transformWorkbookDataToSnapshot,
  type ISnapshotServerService,
} from "@univerjs-pro/collaboration";
import { CellValueType, LocaleType, type IWorkbookData } from "@univerjs/core";
import {
  CmdRspCode,
  CombCmd,
  ErrorCode,
  type IChangeset,
  type ISaveSheetBlockRequest,
  type ISaveSnapshotRequest,
  type ISheetBlock,
} from "@univerjs/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  workspaceDaemonSocketPath,
  workspaceResourceCacheRoot,
  workspaceSessionPath,
} from "../src/config.js";
import { workspaceDaemonIdentity } from "../src/runtime/daemon-identity.js";

const temporaryDirectories: string[] = [];
const applicationRoot = fileURLToPath(new URL("..", import.meta.url));

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (path) => await rm(path, { force: true, recursive: true })),
  );
});

describe("Workspace CLI", () => {
  it("reports the application package version through the built entrypoint", async () => {
    const manifest = JSON.parse(
      await readFile(join(applicationRoot, "package.json"), "utf8"),
    ) as { readonly version: string };

    const version = await runCli(["--version"], process.env);

    expect(version).toMatchObject({
      stderr: "",
      stdout: `univer-workspace-cli ${manifest.version}\n`,
    });
  });

  it("compiles a Typst bundle through the built entrypoint from an arbitrary cwd", async () => {
    const directory = await mkdtemp(join(tmpdir(), "univer-workspace-typst-"));
    temporaryDirectories.push(directory);
    const bundle = join(directory, "paper");
    await mkdir(join(bundle, "pages"), { recursive: true });
    await writeFile(join(bundle, "pages", "one.typ"), "= Hello\n\nWorld", "utf8");
    await writeFile(
      join(bundle, "typst.json"),
      JSON.stringify({
        pages: ["pages/one.typ"],
        schemaVersion: 1,
        targetUnitId: "doc-typst-1",
        title: "Typst paper",
      }),
      "utf8",
    );
    const outputPath = join(directory, "generated", "paper.js");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      UNIVER_HOME: join(directory, "home"),
    };

    const result = JSON.parse(
      (
        await runCli(
          ["compile-typst", bundle, "--out", outputPath, "--json"],
          env,
          undefined,
          directory,
        )
      ).stdout,
    ) as { readonly committed: boolean; readonly compiledTargetUnitId: string };

    expect(result).toMatchObject({ committed: false, compiledTargetUnitId: "doc-typst-1" });
    expect(await readFile(outputPath, "utf8")).toContain("return docMigration.apply");
  }, 30_000);

  it("compiles SVG through the built entrypoint from an arbitrary cwd", async () => {
    const directory = await mkdtemp(join(tmpdir(), "univer-workspace-svg-"));
    temporaryDirectories.push(directory);
    const svgPath = join(directory, "page.svg");
    await writeFile(svgPath, '<svg viewBox="0 0 960 540"><rect width="120" height="80"/></svg>');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      UNIVER_HOME: join(directory, "home"),
    };

    const compiled = JSON.parse(
      (
        await runCli(
          ["compile-svg", svgPath, "--estimate-text-size", "--page", "1", "--json"],
          env,
          undefined,
          directory,
        )
      ).stdout,
    ) as { readonly code: string; readonly page: number; readonly textMeasure: string };

    expect(compiled).toMatchObject({ page: 1, textMeasure: "builtin-estimate" });
    expect(compiled.code).toContain("presentation.appendSlide()");
    expect(() => new Function("presentation", "univerAPI", compiled.code)).not.toThrow();
  }, 30_000);

  it("composes auth, config, API reference, and structured inspection features", async () => {
    const fixture = await createSnapshotFixture();
    const requests: Array<{
      readonly path: string;
      readonly role?: string;
      readonly workerPid?: string;
    }> = [];
    const collaboration = new CollaborationSocketFixture();
    const cliAuthorization = { exchanges: 0, starts: 0 };
    const server = createServer((request, response) => {
      void handleWorkspaceRequest(
        request,
        response,
        fixture,
        requests,
        collaboration,
        cliAuthorization,
      );
    });
    server.on("upgrade", (request, socket) => collaboration.upgrade(request, socket));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing HTTP address");
    const origin = `http://127.0.0.1:${address.port}`;
    const directory = await mkdtemp(join(tmpdir(), "univer-workspace-cli-"));
    temporaryDirectories.push(directory);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      UNIVER_HOME: join(directory, "home"),
    };
    const socketPath = workspaceDaemonSocketPath(env);
    try {
      const configured = await runCli(["config", "set", "workspace.origin", origin, "--json"], env);
      expect(JSON.parse(configured.stdout)).toMatchObject({
        entry: { key: "workspace.origin", source: "config", value: origin },
      });

      const help = await runCli(["--help"], env);
      for (const command of [
        "space",
        "worktree",
        "unit",
        "blob",
        "asset",
        "daemon",
        "open",
        "resources",
        "screenshot",
        "compile-svg",
        "compile-typst",
      ]) {
        expect(help.stdout).toContain(command);
      }

      expect(JSON.parse((await runCli(["daemon", "status", "--json"], env)).stdout)).toEqual({
        socketPath,
        state: "stopped",
      });
      const daemonStarted = JSON.parse(
        (await runCli(["daemon", "start", "--json"], env)).stdout,
      ) as Record<string, unknown>;
      expect(daemonStarted).toMatchObject({
        pid: expect.any(Number),
        socketPath,
        started: true,
        startedAt: expect.any(String),
        state: "running",
      });
      const daemonRestarted = JSON.parse(
        (await runCli(["daemon", "restart", "--json"], env)).stdout,
      ) as Record<string, unknown>;
      expect(daemonRestarted).toMatchObject({
        pid: expect.any(Number),
        previousPid: daemonStarted["pid"],
        restarted: true,
        socketPath,
        startedAt: expect.any(String),
        state: "running",
      });
      expect(daemonRestarted["pid"]).not.toBe(daemonStarted["pid"]);

      const loginHelp = await runCli(["login", "--help"], env);
      expect(loginHelp.stdout).toContain("--complete");
      expect(loginHelp.stdout).toContain("Do not ask the user for a password");

      const loginInstructions = await runCli(["login"], env);
      expect(loginInstructions.stdout).toContain("Browser approval required.");
      expect(loginInstructions.stdout).toContain(
        "This command has exited and is not waiting.",
      );
      expect(loginInstructions.stdout).toContain(
        `${origin}/cli-login?userCode=ABCD-EFGH`,
      );
      expect(loginInstructions.stdout).toContain("univer-workspace-cli login --complete");

      const authorization = await runCli(["login", "--json"], env);
      expect(JSON.parse(authorization.stdout)).toMatchObject({
        status: "authorization_required",
        origin,
        userCode: "ABCD-EFGH",
        verificationUrl: `${origin}/cli-login?userCode=ABCD-EFGH`,
        nextCommand: "univer-workspace-cli login --complete",
      });
      const sessionPath = workspaceSessionPath(env);
      expect((await stat(sessionPath)).mode & 0o777).toBe(0o600);

      const stillPending = await runCli(["login", "--complete", "--json"], env);
      expect(JSON.parse(stillPending.stdout)).toMatchObject({
        status: "authorization_pending",
        origin,
        userCode: "ABCD-EFGH",
      });

      const loggedIn = await runCli(["login", "--complete", "--json"], env);
      expect(JSON.parse(loggedIn.stdout)).toEqual({
        status: "authenticated",
        origin,
        subject: { id: "user-1", name: "Alice" },
      });

      const identity = await runCli(["whoami", "--json"], env);
      expect(JSON.parse(identity.stdout)).toEqual({
        origin,
        subject: { id: "user-1", name: "Alice" },
      });
      expect(cliAuthorization).toEqual({ exchanges: 2, starts: 2 });
      for (const result of [loginInstructions, authorization, stillPending, loggedIn, identity]) {
        expect(`${result.stdout}${result.stderr}`).not.toContain("a".repeat(43));
        expect(`${result.stdout}${result.stderr}`).not.toContain("workspace_session=test");
      }

      const api = await runCli(["api", "show", "FRange.setValues"], env);
      expect(api.stdout).toContain("setValues(");

      const registries = await runCli(["resources", "registries", "--json"], env);
      expect(
        (JSON.parse(registries.stdout) as { readonly registries: readonly unknown[] }).registries,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "boards-local-svgl", resourceCount: 1081 }),
          expect.objectContaining({ id: "example-tabler-outline", resourceCount: 5093 }),
        ]),
      );
      const resources = await runCli(
        [
          "resources",
          "find",
          "rocket",
          "--registry",
          "example-tabler-outline",
          "--limit",
          "1",
          "--json",
        ],
        env,
      );
      expect(JSON.parse(resources.stdout)).toMatchObject({
        query: { queries: ["rocket"], registries: ["example-tabler-outline"] },
        limit: 1,
        resources: [{ registryId: "example-tabler-outline" }],
      });
      const cache = await runCli(["resources", "cache", "path", "--json"], env);
      expect(JSON.parse(cache.stdout)).toEqual({
        path: workspaceResourceCacheRoot(env),
      });

      const inspected = await runCli(
        [
          "inspect",
          "range",
          "A1",
          "--worksheet",
          "id:sheet-1",
          "--worktree",
          "wt-1",
          "--unit",
          "unit-1",
          "--json",
        ],
        env,
      );
      expect(JSON.parse(inspected.stdout)).toMatchObject({
        kind: "worksheet-range",
        unitId: "unit-1",
        ranges: [
          {
            displayValues: [["remote"]],
            requestedRange: "A1",
            worksheet: { id: "sheet-1", name: "Sheet1" },
          },
        ],
      });
      const runtimeClient = createDaemonClient({
        entry: publishedDaemonEntry(),
        env,
        identity: workspaceDaemonIdentity(env),
        socketPath,
      });
      await expect(
        runtimeClient.request("runtime.export-unit-data", {
          target: {
            origin,
            revision: 1,
            scope: { kind: "worktree", worktreeId: "wt-1" },
            unitId: "unit-1",
            unitType: "sheet",
          },
        }),
      ).resolves.toMatchObject({ id: "unit-1", sheets: { "sheet-1": { name: "Sheet1" } } });
      const trunkInspected = await runCli(
        [
          "inspect",
          "range",
          "A1",
          "--worksheet",
          "id:sheet-1",
          "--trunk",
          "--unit",
          "unit-1",
          "--json",
        ],
        env,
      );
      expect(JSON.parse(trunkInspected.stdout)).toMatchObject({
        kind: "worksheet-range",
        unitId: "unit-1",
        ranges: [{ displayValues: [["remote"]], requestedRange: "A1" }],
      });
      const executed = await runCli(
        [
          "execute",
          "--worktree",
          "wt-1",
          "--unit",
          "unit-1",
          "--code",
          `const sheet = workbook.getActiveSheet();
           const formula = univerAPI.getFormula();
           const reference = formula.buildReference({
             hostUnitId: workbook.getId(),
             unit: { unitId: "source-unit", formulaQualifier: "Source Data" },
             target: {
               kind: univerAPI.Enum.FormulaReferenceType.SHEET_RANGE,
               sheetName: "Sheet1",
               range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }
             }
           });
           const calculated = formula.onCalculationResultApplied(30_000);
           sheet.getRange("B1").setFormula("=" + reference);
           await calculated;
           const sourceValue = sheet.getRange("B1").getValue();
           const embed = univerAPI.createEmbed({
             embedId: "embedded-doc",
             host: {
               unitId: workbook.getId(),
               surface: univerAPI.Enum.FEmbedHostSurface.SheetTab
             },
             content: {
               unitType: univerAPI.Enum.UniverInstanceType.UNIVER_DOC,
               ref: "#unit=embed-source-unit&type=doc"
             },
             interaction: "interactive"
           });
           const embedded = await embed.loadAsync();
           const range = sheet.getRange("A1");
           range.setValue("edited");
           return {
             edited: range.getValue(),
             embeddedUnitId: embedded?.getId?.() ?? null,
             formula: sheet.getRange("B1").getFormula(),
             sourceValue
           };`,
          "--json",
        ],
        env,
      );
      expect(JSON.parse(executed.stdout)).toEqual({
        committed: true,
        revision: 2,
        status: "committed",
        value: {
          edited: "edited",
          embeddedUnitId: "embed-source-unit",
          formula: "='[Source Data]Sheet1'!A1",
          sourceValue: 42,
        },
      });
      expect(collaboration.submittedChangesets).toHaveLength(1);
      expect(collaboration.submittedChangesets[0]).toMatchObject({
        baseRev: 1,
        revision: 0,
        unitID: "unit-1",
      });
      expect(collaboration.submittedChangesets[0]?.mutations.length).toBeGreaterThan(0);
      expect(requests.map((request) => request.path)).toEqual(
        expect.arrayContaining([
          "/api/worktrees/wt-1",
          "/universer-api/worktrees/wt-1/snapshot/2/unit/unit-1/rev/0",
          "/universer-api/snapshot/2/unit/unit-1/rev/0",
          "/universer-api/snapshot/2/unit/source-unit/rev/0",
          "/universer-api/snapshot/block/2/unit/source-unit/block/source-block",
          "/universer-api/snapshot/1/unit/embed-source-unit/rev/0",
          ...fixture.blocks.map(
            (block) =>
              `/universer-api/worktrees/wt-1/snapshot/2/unit/unit-1/block/${encodeURIComponent(block.id)}`,
          ),
          ...fixture.blocks.map(
            (block) =>
              `/universer-api/snapshot/2/unit/unit-1/block/${encodeURIComponent(block.id)}`,
          ),
        ]),
      );
      const metadataRequests = requests.filter((request) => request.path === "/api/worktrees/wt-1");
      expect(metadataRequests).toEqual([
        expect.objectContaining({ role: "client" }),
        expect.objectContaining({ role: "worker" }),
        expect.objectContaining({ role: "client" }),
      ]);
      expect(
        metadataRequests
          .filter((request) => request.role === "client")
          .every((request) => request.workerPid === undefined),
      ).toBe(true);
      const trunkDiscoveryRequests = requests.filter(
        (request) =>
          request.path === "/universer-api/snapshot/2/unit/unit-1/rev/0" &&
          request.role === "client",
      );
      expect(trunkDiscoveryRequests).toHaveLength(1);
      expect(trunkDiscoveryRequests[0]?.workerPid).toBeUndefined();
      const runtimeRequests = requests.filter(
        (request) => request.path.startsWith("/universer-api/") && request.role === "worker",
      );
      expect(runtimeRequests.length).toBeGreaterThan(0);
      expect(
        runtimeRequests.every(
          (request) =>
            request.workerPid !== String(inspected.pid) &&
            request.workerPid !== String(trunkInspected.pid),
        ),
      ).toBe(true);

      const svgPath = join(directory, "apply.svg");
      await writeFile(
        svgPath,
        '<svg viewBox="0 0 960 540"><rect width="120" height="80" fill="#2563eb"/></svg>',
      );
      const appliedOutput = await runCli(
        [
          "compile-svg",
          svgPath,
          "--estimate-text-size",
          "--page",
          "1",
          "--apply",
          "--worktree",
          "wt-1",
          "--unit",
          "slide-1",
          "--json",
        ],
        env,
      );
      const appliedSvg = JSON.parse(appliedOutput.stdout) as {
        readonly applied: { readonly committed: boolean; readonly revision: number };
      };
      expect(appliedSvg.applied).toEqual({
        committed: true,
        revision: 2,
        status: "committed",
        value: null,
      });
      expect(collaboration.submittedChangesets).toHaveLength(2);
      expect(collaboration.submittedChangesets[1]).toMatchObject({
        baseRev: 1,
        revision: 0,
        unitID: "slide-1",
      });
      expect(collaboration.submittedChangesets[1]?.mutations.length).toBeGreaterThan(0);

      const loggedOut = await runCli(["logout", "--json"], env);
      expect(JSON.parse(loggedOut.stdout)).toEqual({ loggedOut: true, origin });
      expect(`${loggedOut.stdout}${loggedOut.stderr}`).not.toContain("workspace_session=test");
      expect(JSON.parse(await readFile(sessionPath, "utf8"))).toEqual({ sessions: {} });
      expect(JSON.parse((await runCli(["daemon", "stop", "--json"], env)).stdout)).toEqual({
        socketPath,
        state: "stopped",
        stopped: true,
      });
    } finally {
      const daemon = createDaemonControl({
        entry: publishedDaemonEntry(),
        env,
        identity: workspaceDaemonIdentity(env),
        socketPath,
      });
      await daemon.stop().catch(() => undefined);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 120_000);
});

async function createSnapshotFixture(): Promise<{
  readonly blocks: readonly ISheetBlock[];
  readonly sheetSnapshot: unknown;
  readonly slideSnapshot: unknown;
}> {
  const blocks: ISheetBlock[] = [];
  const ok = { code: ErrorCode.OK, message: "" };
  const saveSnapshot = async (_context: unknown, request: ISaveSnapshotRequest) => {
    if (!request.snapshot) throw new Error("missing snapshot");
    return { error: ok };
  };
  const snapshotService = {
    saveSnapshot,
    updateSnapshot: saveSnapshot,
    saveSheetBlock: async (_context: unknown, request: ISaveSheetBlockRequest) => {
      if (!request.block) throw new Error("missing block");
      blocks.push(request.block);
      return { blockID: request.block.id, error: ok };
    },
  } as ISnapshotServerService;
  const { snapshot: sheetSnapshot } = await transformWorkbookDataToSnapshot(
    {},
    workbookData(),
    "unit-1",
    1,
    snapshotService,
  );
  const { snapshot: slideSnapshot } = await transformSlideDataToSnapshot(
    [],
    slideData(),
    "slide-1",
    1,
    snapshotService,
  );
  return { blocks, sheetSnapshot, slideSnapshot };
}

async function handleWorkspaceRequest(
  request: IncomingMessage,
  response: ServerResponse,
  fixture: {
    readonly blocks: readonly ISheetBlock[];
    readonly sheetSnapshot: unknown;
    readonly slideSnapshot: unknown;
  },
  requests: Array<{ path: string; role?: string; workerPid?: string }>,
  collaboration: CollaborationSocketFixture,
  cliAuthorization: { exchanges: number; starts: number },
): Promise<void> {
  requests.push({
    path: request.url ?? "",
    ...(typeof request.headers["x-univer-cli-sdk-role"] === "string"
      ? { role: request.headers["x-univer-cli-sdk-role"] }
      : {}),
    ...(typeof request.headers["x-univer-cli-sdk-worker-pid"] === "string"
      ? { workerPid: request.headers["x-univer-cli-sdk-worker-pid"] }
      : {}),
  });
  if (request.method === "POST" && request.url === "/api/auth/password/login") {
    const body = await readJsonBody(request);
    if (body["username"] !== "alice" || body["password"] !== "secret") {
      writeJson(response, 401, { error: { code: "INVALID_CREDENTIALS" } });
      return;
    }
    writeJson(
      response,
      200,
      { authenticated: true, user: { displayName: "Alice", id: "user-1" } },
      { "set-cookie": "workspace_session=test; Path=/; HttpOnly" },
    );
    return;
  }
  if (request.method === "POST" && request.url === "/api/auth/cli/authorizations") {
    cliAuthorization.starts += 1;
    writeJson(response, 201, {
      deviceCode: "a".repeat(43),
      userCode: "ABCD-EFGH",
      verificationUri: "/cli-login",
      verificationUriComplete: "/cli-login?userCode=ABCD-EFGH",
      expiresIn: 600,
      interval: 2,
    });
    return;
  }
  if (
    request.method === "POST" &&
    request.url === "/api/auth/cli/authorizations/exchange"
  ) {
    const body = await readJsonBody(request);
    if (body["deviceCode"] !== "a".repeat(43)) {
      writeJson(response, 400, { error: { code: "CLI_AUTHORIZATION_INVALID" } });
      return;
    }
    cliAuthorization.exchanges += 1;
    if (cliAuthorization.exchanges === 1) {
      writeJson(response, 202, { status: "pending" });
      return;
    }
    writeJson(
      response,
      200,
      { authenticated: true, user: { displayName: "Alice", id: "user-1" } },
      { "set-cookie": "workspace_session=test; Path=/; HttpOnly" },
    );
    return;
  }
  if (request.headers.cookie !== "workspace_session=test") {
    writeJson(response, 401, { error: { code: "UNAUTHORIZED", message: "missing session" } });
    return;
  }
  if (request.method === "GET" && request.url === "/api/session") {
    writeJson(response, 200, {
      authenticated: true,
      user: { displayName: "Alice", id: "user-1" },
    });
    return;
  }
  if (request.method === "POST" && request.url === "/api/auth/logout") {
    writeJson(response, 200, {});
    return;
  }
  if (request.url === "/api/worktrees/wt-1") {
    writeJson(response, 200, {
      worktree: {
        id: "wt-1",
        name: "Draft",
        state: "draft",
        teamSpace: null,
        units: [
          runtimeUnit("unit-1", "sheet"),
          runtimeUnit("slide-1", "slide"),
        ],
      },
    });
    return;
  }
  if (request.url === "/universer-api/user/session-ticket") {
    writeJson(response, 200, { ticket: "ticket-1" });
    return;
  }
  if (request.url === "/universer-api/worktrees/wt-1/snapshot/2/unit/unit-1/rev/0") {
    writeJson(response, 200, { changesets: [], snapshot: fixture.sheetSnapshot });
    return;
  }
  if (request.url === "/universer-api/snapshot/2/unit/unit-1/rev/0") {
    writeJson(response, 200, { changesets: [], snapshot: fixture.sheetSnapshot });
    return;
  }
  if (request.url === "/universer-api/worktrees/wt-1/snapshot/3/unit/slide-1/rev/0") {
    writeJson(response, 200, { changesets: [], snapshot: fixture.slideSnapshot });
    return;
  }
  if (request.url === "/universer-api/snapshot/2/unit/source-unit/rev/0") {
    writeJson(response, 200, { changesets: [], snapshot: sourceSnapshot() });
    return;
  }
  if (request.url === "/universer-api/snapshot/1/unit/embed-source-unit/rev/0") {
    writeJson(response, 200, { changesets: [], snapshot: embeddedDocSnapshot() });
    return;
  }
  if (request.url === "/universer-api/snapshot/block/2/unit/source-unit/block/source-block") {
    writeJson(response, 200, {
      block: {
        data: { 0: { 0: { t: CellValueType.NUMBER, v: 42 } } },
        endRow: 0,
        id: "source-block",
        startRow: 0,
      },
    });
    return;
  }
  if (request.url?.includes("/snapshot/2/unit/unit-1/fetchmissing?")) {
    writeJson(response, 200, { changesets: [], latestRevision: 1 });
    return;
  }
  if (request.url?.includes("/snapshot/3/unit/slide-1/fetchmissing?")) {
    writeJson(response, 200, { changesets: [], latestRevision: 1 });
    return;
  }
  if (
    request.method === "POST" &&
    (request.url?.endsWith("/comb/2/unit/unit-1/new_changes") === true ||
      request.url?.endsWith("/comb/3/unit/slide-1/new_changes") === true)
  ) {
    const body = await readJsonBody(request);
    const changeset = body["changeset"] as IChangeset;
    collaboration.acknowledge(request.url, changeset);
    writeJson(response, 200, { error: { code: 0, message: "" } });
    return;
  }
  const blockPrefixes = [
    "/universer-api/worktrees/wt-1/snapshot/2/unit/unit-1/block/",
    "/universer-api/snapshot/2/unit/unit-1/block/",
  ];
  const blockPrefix = blockPrefixes.find((prefix) => request.url?.startsWith(prefix));
  if (blockPrefix !== undefined) {
    const id = decodeURIComponent((request.url ?? "").slice(blockPrefix.length));
    const block = fixture.blocks.find((candidate) => candidate.id === id);
    writeJson(response, block ? 200 : 404, block ? { block } : { error: { code: "NOT_FOUND" } });
    return;
  }
  writeJson(response, 404, { error: { code: "NOT_FOUND" } });
}

class CollaborationSocketFixture {
  public readonly submittedChangesets: IChangeset[] = [];
  private readonly peers = new Set<CollaborationSocketPeer>();

  public upgrade(request: IncomingMessage, socket: Duplex): void {
    socket.on("error", () => undefined);
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string" || !request.url?.includes("/comb/connect")) {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );
    const peer = new CollaborationSocketPeer(request.url, socket);
    this.peers.add(peer);
    socket.once("close", () => this.peers.delete(peer));
  }

  public acknowledge(path: string, submitted: IChangeset): void {
    this.submittedChangesets.push(submitted);
    const scope = path.startsWith("/universer-api/worktrees/")
      ? "/universer-api/worktrees/wt-1/"
      : "/universer-api/";
    const peer = [...this.peers].find(
      (candidate) => candidate.path.startsWith(scope) && candidate.hasJoined(submitted.unitID),
    );
    if (peer === undefined) throw new Error("missing Collaboration WebSocket peer");
    peer.send({
      cmd: CombCmd.RECV,
      code: CmdRspCode.OK,
      collaMsg: {
        csAckEvent: {
          cs: { ...submitted, memberID: "member-1", revision: submitted.baseRev + 1 },
        },
        eventID: "changeset_ack",
      },
      routeKey: submitted.unitID,
    });
  }
}

class CollaborationSocketPeer {
  private buffer = Buffer.alloc(0);
  private readonly joinedUnitIds = new Set<string>();

  public constructor(
    public readonly path: string,
    private readonly socket: Duplex,
  ) {
    socket.on("data", (chunk: Buffer) => this.receive(chunk));
  }

  public send(value: unknown): void {
    const payload = Buffer.from(JSON.stringify(value));
    const header =
      payload.length < 126
        ? Buffer.from([0x81, payload.length])
        : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
    this.socket.write(Buffer.concat([header, payload]));
  }

  public hasJoined(unitId: string): boolean {
    return this.joinedUnitIds.has(unitId);
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.readFrame()) {
      // Drain all complete frames.
    }
  }

  private readFrame(): boolean {
    if (this.buffer.length < 2) return false;
    const first = this.buffer[0]!;
    const second = this.buffer[1]!;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (this.buffer.length < 4) return false;
      length = this.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (this.buffer.length < 10) return false;
      const wideLength = this.buffer.readBigUInt64BE(2);
      if (wideLength > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error("WebSocket frame too large");
      length = Number(wideLength);
      offset = 10;
    }
    const masked = (second & 0x80) !== 0;
    const maskBytes = masked ? 4 : 0;
    if (this.buffer.length < offset + maskBytes + length) return false;
    const mask = masked ? this.buffer.subarray(offset, offset + 4) : undefined;
    offset += maskBytes;
    const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
    this.buffer = this.buffer.subarray(offset + length);
    if (mask !== undefined) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] = payload[index]! ^ mask[index % 4]!;
      }
    }
    const opcode = first & 0x0f;
    if (opcode === 0x8) {
      this.socket.end(Buffer.from([0x88, 0x00]));
      return true;
    }
    if (opcode === 0x9) {
      this.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
      return true;
    }
    if (opcode !== 0x1) return true;
    this.handleMessage(JSON.parse(payload.toString("utf8")) as Record<string, unknown>);
    return true;
  }

  private handleMessage(message: Record<string, unknown>): void {
    if (message["cmd"] === CombCmd.HELLO) {
      this.send({
        cmd: CombCmd.HELLO,
        code: CmdRspCode.OK,
        infoRsp: { memberID: "member-1" },
        routeKey: "",
      });
    } else if (message["cmd"] === CombCmd.JOIN) {
      if (typeof message["routeKey"] === "string") {
        this.joinedUnitIds.add(message["routeKey"]);
      }
      this.send({
        cmd: CombCmd.JOIN,
        code: CmdRspCode.OK,
        joinRsp: { roomInfos: {} },
        routeKey: message["routeKey"],
      });
    } else if (message["cmd"] === CombCmd.HEARTBEAT) {
      this.send({ cmd: CombCmd.HEARTBEAT, code: CmdRspCode.OK, routeKey: "" });
    }
  }
}

function runtimeUnit(unitId: string, unitType: "sheet" | "slide"): Record<string, unknown> {
  return {
    activationState: "notApplicable",
    change: "unchanged",
    draftHeadRevision: 1,
    mergeResult: "pending",
    name: unitId,
    nodeId: `node-${unitId}`,
    resourceId: `resource-${unitId}`,
    source: "trunk",
    target: null,
    unitId,
    unitType,
  };
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(
    JSON.stringify(value, (_key, child) =>
      child instanceof Uint8Array ? Buffer.from(child).toString("base64") : child,
    ),
  );
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let source = "";
  for await (const chunk of request) {
    source += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  }
  const value = JSON.parse(source) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected JSON object");
  }
  return value as Record<string, unknown>;
}

function collect(child: ReturnType<typeof spawn>): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stderr, stdout });
      else reject(new Error(`Workspace CLI exited ${String(code)}: ${stderr}`));
    });
  });
}

async function runCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input?: string,
  cwd = process.cwd(),
): Promise<{ readonly pid: number | undefined; readonly stderr: string; readonly stdout: string }> {
  const entry = join(applicationRoot, "dist/main.js");
  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    env,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (input !== undefined) child.stdin?.end(input);
  return { ...(await collect(child)), pid: child.pid };
}

function publishedDaemonEntry(): URL {
  return pathToFileURL(join(applicationRoot, "dist/runtime/daemon.js"));
}

function workbookData(): IWorkbookData {
  return {
    id: "unit-1",
    name: "Remote Workbook",
    appVersion: "0.25.0",
    locale: "enUS",
    sheetOrder: ["sheet-1"],
    sheets: {
      "sheet-1": {
        id: "sheet-1",
        name: "Sheet1",
        rowCount: 10,
        columnCount: 5,
        cellData: { 0: { 0: { v: "remote" } } },
      },
    },
    styles: {},
    resources: [],
  } as IWorkbookData;
}

function slideData(): Parameters<typeof transformSlideDataToSnapshot>[1] {
  return {
    activeSlideId: "",
    appVersion: "",
    defaultPageSize: { height: 540, width: 960 },
    id: "slide-1",
    locale: LocaleType.EN_US,
    name: "SVG target",
    resources: [],
    rev: 1,
    slideOrder: [],
    slides: {},
  };
}

function sourceSnapshot(): unknown {
  const metadata = Buffer.from("{}").toString("base64");
  return {
    rev: 1,
    type: 2,
    unitID: "source-unit",
    workbook: {
      blockMeta: {
        "source-sheet": { blocks: ["source-block"], sheetID: "source-sheet" },
      },
      creator: "",
      name: "Source Data",
      originalMeta: metadata,
      resources: [],
      rev: 1,
      sheetOrder: ["source-sheet"],
      sheets: {
        "source-sheet": {
          columnCount: 5,
          id: "source-sheet",
          name: "Sheet1",
          originalMeta: metadata,
          rowCount: 10,
          type: 0,
        },
      },
      unitID: "source-unit",
    },
  };
}

function embeddedDocSnapshot(): unknown {
  return {
    doc: {
      creator: "",
      name: "Embedded Doc",
      originalMeta: Buffer.from(
        JSON.stringify({ body: { dataStream: "Embedded content\r\n" } }),
      ).toString("base64"),
      resources: [],
      rev: 1,
      unitID: "embed-source-unit",
    },
    rev: 1,
    type: 1,
    unitID: "embed-source-unit",
  };
}
