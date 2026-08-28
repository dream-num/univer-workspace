import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { transformWorkbookDataToSnapshot } from "@univerjs-pro/collaboration";
import { CmdRspCode, CombCmd, ErrorCode } from "@univerjs/protocol";

const packageRoot = resolve(process.argv[2] ?? "package-dist");
const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const registry = packageManifest.publishConfig?.registry;
if (typeof registry !== "string" || registry === "") {
  throw new Error("Package manifest must declare publishConfig.registry");
}
const temporaryRoot = await mkdtemp(join(tmpdir(), "univer-workspace-cli-package-"));
const workspaceFixture = await startWorkspaceFixture();
let executable;
let smokeEnv;

try {
  const tarballRoot = join(temporaryRoot, "tarball");
  const installRoot = join(temporaryRoot, "install");
  const univerHome = join(temporaryRoot, "home");
  await Promise.all([mkdir(tarballRoot), mkdir(installRoot), mkdir(univerHome)]);
  const blobSourcePath = join(temporaryRoot, "blob-source.bin");
  const blobOutputPath = join(temporaryRoot, "blob-output.bin");
  const assetOutputPath = join(temporaryRoot, "asset-output.bin");
  await Promise.all([
    writeFile(blobSourcePath, "blob-bytes"),
    writeFile(blobOutputPath, "replace-me"),
    writeFile(assetOutputPath, "replace-me"),
  ]);

  const packed = await run(
    "npm",
    ["pack", "--json", `--pack-destination=${tarballRoot}`],
    packageRoot,
  );
  const artifacts = JSON.parse(packed.stdout);
  if (!Array.isArray(artifacts) || artifacts.length !== 1) {
    throw new Error("npm pack must produce exactly one artifact");
  }
  const tarball = join(tarballRoot, basename(artifacts[0].filename));
  await run(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      `--registry=${registry}`,
      tarball,
    ],
    installRoot,
  );

  executable = join(
    installRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "univer-workspace-cli.cmd" : "univer-workspace-cli",
  );
  smokeEnv = { ...process.env, UNIVER_HOME: univerHome };
  const version = await run(executable, ["--version"], installRoot, smokeEnv);
  const expectedVersion = `univer-workspace-cli ${packageManifest.version}`;
  if (version.stdout.trim() !== expectedVersion) {
    throw new Error(
      `Installed CLI version mismatch: expected ${expectedVersion}, got ${version.stdout.trim()}`,
    );
  }
  await run(executable, ["--help"], installRoot, smokeEnv);
  await run(executable, ["skills", "list", "--json"], installRoot, smokeEnv);
  await run(executable, ["api", "--help"], installRoot, smokeEnv);
  await run(executable, ["space", "--help"], installRoot, smokeEnv);
  const installedPackageRoot = join(installRoot, "node_modules", "univer-workspace-cli");
  await assertInstalledRenderPage(installedPackageRoot);
  const installedRequire = createRequire(join(installedPackageRoot, "package.json"));
  installedRequire.resolve("puppeteer-core");
  installedRequire.resolve("@puppeteer/browsers");
  const renderSurfaceCwd = join(temporaryRoot, "render-surface-cwd");
  await mkdir(renderSurfaceCwd);
  await run(executable, ["screenshot", "--help"], renderSurfaceCwd, smokeEnv);
  await run(executable, ["screenshot", "setup", "--help"], renderSurfaceCwd, smokeEnv);
  await run(executable, ["lint", "--help"], renderSurfaceCwd, smokeEnv);
  const typstCwd = join(temporaryRoot, "typst-cwd");
  const typstBundle = join(typstCwd, "paper");
  const typstOutput = join(typstCwd, "generated", "paper.js");
  const typstDiagnostics = join(typstCwd, "generated", "diagnostics.json");
  await mkdir(join(typstBundle, "pages"), { recursive: true });
  await Promise.all([
    writeFile(join(typstBundle, "pages", "one.typ"), "= Hello\n\nWorld", "utf8"),
    writeFile(
      join(typstBundle, "typst.json"),
      JSON.stringify({
        pages: ["pages/one.typ"],
        schemaVersion: 1,
        targetUnitId: "installed-typst-doc",
        title: "Installed Typst paper",
      }),
      "utf8",
    ),
  ]);
  const typstCompilation = await run(
    executable,
    [
      "compile-typst",
      "paper",
      "--out",
      typstOutput,
      "--diagnostics-out",
      typstDiagnostics,
      "--json",
    ],
    typstCwd,
    smokeEnv,
  );
  const typstValue = JSON.parse(typstCompilation.stdout);
  const typstDiagnosticValue = JSON.parse(await readFile(typstDiagnostics, "utf8"));
  if (
    typstValue.committed !== false ||
    typstValue.compiledTargetUnitId !== "installed-typst-doc" ||
    !Array.isArray(typstValue.diagnostics) ||
    !Array.isArray(typstValue.previews) ||
    typstDiagnosticValue.schemaVersion !== 1 ||
    !Array.isArray(typstDiagnosticValue.diagnostics) ||
    !(await readFile(typstOutput, "utf8")).includes("return docMigration.apply")
  ) {
    throw new Error("Installed CLI returned an invalid Typst compilation result");
  }
  const svgCwd = join(temporaryRoot, "svg-cwd");
  const svgSourceRoot = join(svgCwd, "nested");
  await mkdir(join(svgSourceRoot, "assets"), { recursive: true });
  await Promise.all([
    writeFile(
      join(svgSourceRoot, "page.svg"),
      '<svg viewBox="0 0 320 180"><image href="assets/pixel.png" width="1" height="1"/><text x="10" y="30">世界</text></svg>',
      "utf8",
    ),
    writeFile(
      join(svgSourceRoot, "assets", "pixel.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    ),
  ]);
  const svgCompilation = await run(
    executable,
    ["compile-svg", "nested/page.svg", "--estimate-text-size", "--page", "1", "--json"],
    svgCwd,
    smokeEnv,
  );
  const svgValue = JSON.parse(svgCompilation.stdout);
  if (
    svgValue.page !== 1 ||
    svgValue.textMeasure !== "builtin-estimate" ||
    !svgValue.code?.includes("presentation.appendSlide()") ||
    !svgValue.code?.includes("insertImage")
  ) {
    throw new Error("Installed CLI returned an invalid SVG compilation result");
  }
  await run(
    executable,
    ["config", "set", "workspace.origin", workspaceFixture.origin, "--json"],
    installRoot,
    smokeEnv,
  );
  const authorization = await run(executable, ["login", "--json"], installRoot, smokeEnv);
  const pending = await run(
    executable,
    ["login", "--complete", "--json"],
    installRoot,
    smokeEnv,
  );
  const authenticated = await run(
    executable,
    ["login", "--complete", "--json"],
    installRoot,
    smokeEnv,
  );
  const identity = await run(executable, ["whoami", "--json"], installRoot, smokeEnv);
  const spaces = await run(executable, ["space", "list", "--json"], installRoot, smokeEnv);
  const nodes = await run(
    executable,
    ["space", "browse", "space-1", "--json"],
    installRoot,
    smokeEnv,
  );
  const worktrees = await run(
    executable,
    ["worktree", "list", "--json"],
    installRoot,
    smokeEnv,
  );
  const createdWorktree = await run(
    executable,
    [
      "worktree",
      "create",
      "--name",
      "Draft",
      "--scope",
      "user",
      "--idempotency-key",
      "smoke-worktree",
      "--json",
    ],
    installRoot,
    smokeEnv,
  );
  const updatedWorktree = await run(
    executable,
    ["worktree", "update", "wt-1", "--name", "Renamed", "--json"],
    installRoot,
    smokeEnv,
  );
  const readyWorktree = await run(
    executable,
    ["worktree", "ready", "wt-1", "--json"],
    installRoot,
    smokeEnv,
  );
  const addedUnit = await run(
    executable,
    ["unit", "add", "--worktree", "wt-1", "--resource", "resource-1", "--json"],
    installRoot,
    smokeEnv,
  );
  const createdUnit = await run(
    executable,
    [
      "unit",
      "create",
      "--worktree",
      "wt-1",
      "--space",
      "space-1",
      "--type",
      "doc",
      "--name",
      "Planning",
      "--idempotency-key",
      "smoke-unit",
      "--json",
    ],
    installRoot,
    smokeEnv,
  );
  const units = await run(
    executable,
    ["unit", "list", "--worktree", "wt-1", "--json"],
    installRoot,
    smokeEnv,
  );
  const opened = await run(
    executable,
    [
      "open",
      "--worktree",
      "wt-1",
      "--unit",
      "unit-1",
      "--viewer-url",
      `${workspaceFixture.origin}/old?query=1#fragment`,
      "--json",
    ],
    installRoot,
    smokeEnv,
  );
  const uploadedBlob = await run(
    executable,
    [
      "blob",
      "upload",
      "--file",
      blobSourcePath,
      "--space",
      "space-1",
      "--idempotency-key",
      "smoke-blob",
      "--json",
    ],
    installRoot,
    smokeEnv,
  );
  const blob = await run(
    executable,
    ["blob", "get", "resource-blob", "--json"],
    installRoot,
    smokeEnv,
  );
  const downloadedBlob = await run(
    executable,
    [
      "blob",
      "download",
      blobOutputPath,
      "--resource",
      "resource-blob",
      "--force",
      "--json",
    ],
    installRoot,
    smokeEnv,
  );
  const downloadedAsset = await run(
    executable,
    [
      "asset",
      "download",
      assetOutputPath,
      "--id",
      "asset-1",
      "--worktree",
      "wt-1",
      "--force",
      "--json",
    ],
    installRoot,
    smokeEnv,
  );
  const inspected = await run(
    executable,
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
    installRoot,
    smokeEnv,
  );
  const loggedOut = await run(executable, ["logout", "--json"], installRoot, smokeEnv);
  const outcomes = [
    authorization,
    pending,
    authenticated,
    identity,
    spaces,
    nodes,
    worktrees,
    createdWorktree,
    updatedWorktree,
    readyWorktree,
    addedUnit,
    createdUnit,
    units,
    opened,
    uploadedBlob,
    blob,
    downloadedBlob,
    downloadedAsset,
    loggedOut,
  ];
  const values = outcomes.map((result) => JSON.parse(result.stdout));
  if (
    values[0].status !== "authorization_required" ||
    values[1].status !== "authorization_pending" ||
    values[2].status !== "authenticated" ||
    values[3].subject?.id !== "package-smoke-user" ||
    !Array.isArray(values[4].spaces) ||
    !Array.isArray(values[5].nodes) ||
    !Array.isArray(values[6].worktrees) ||
    values[7].worktree?.id !== "wt-1" ||
    values[8].worktree?.name !== "Renamed" ||
    values[9].worktree?.state !== "ready" ||
    values[10].unit?.source !== "trunk" ||
    values[11].unit?.source !== "worktree" ||
    !Array.isArray(values[12].units) ||
    values[13].data?.openUrl !==
      `${workspaceFixture.origin}/worktrees?worktree=wt-1&unit=unit-1&view=agent` ||
    values[14].upload?.resourceId !== "resource-blob" ||
    values[15].resource?.resourceId !== "resource-blob" ||
    values[16].download?.resourceId !== "resource-blob" ||
    values[17].download?.assetId !== "asset-1" ||
    values[18].loggedOut !== true
  ) {
    throw new Error("Installed authentication fixture returned an invalid result");
  }
  const inspectedValue = JSON.parse(inspected.stdout);
  if (
    inspectedValue.kind !== "worksheet-range" ||
    inspectedValue.unitId !== "unit-1" ||
    inspectedValue.ranges?.[0]?.displayValues?.[0]?.[0] !== "runtime-smoke"
  ) {
    throw new Error("Installed runtime fixture returned an invalid inspection result");
  }
  if (
    (await readFile(blobOutputPath, "utf8")) !== "blob-bytes" ||
    (await readFile(assetOutputPath, "utf8")) !== "asset-bytes" ||
    ((await stat(blobOutputPath)).mode & 0o777) !== 0o600 ||
    ((await stat(assetOutputPath)).mode & 0o777) !== 0o600
  ) {
    throw new Error("Installed file-transfer fixture returned invalid bytes or modes");
  }
  if (
    [...outcomes, inspected, typstCompilation, svgCompilation].some((result) =>
      `${result.stdout}${result.stderr}`.includes(workspaceFixture.deviceCode) ||
      `${result.stdout}${result.stderr}`.includes(workspaceFixture.cookie)
    )
  ) {
    throw new Error("Installed authentication fixture disclosed a credential");
  }
  if (JSON.stringify(workspaceFixture.requests) !== JSON.stringify({
    authorizationStarts: 1,
    authorizationExchanges: 2,
    whoami: 1,
    spaceList: 1,
    spaceBrowse: 1,
    worktreeList: 1,
    worktreeCreate: ["smoke-worktree"],
    worktreeUpdate: 1,
    worktreeGet: 5,
    worktreeReady: 1,
    unitAdd: [stableKey("add-unit", "wt-1", "resource-1")],
    unitCreate: ["smoke-unit"],
    blobReserve: ["smoke-blob"],
    blobPut: 1,
    blobStatus: 1,
    blobComplete: 1,
    blobResource: 2,
    blobDownload: 1,
    assetSign: 1,
    assetContent: 1,
    logout: 1,
  })) {
    throw new Error("Installed authentication fixture received unexpected requests");
  }
  if (
    JSON.stringify(workspaceFixture.runtimeRequests.map((request) => request.path).sort()) !==
      JSON.stringify([
        "/api/worktrees/wt-1",
        "/universer-api/user/session-ticket",
        "/universer-api/worktrees/wt-1/snapshot/2/unit/unit-1/fetchmissing?from=1&to=0",
        "/universer-api/worktrees/wt-1/snapshot/2/unit/unit-1/fetchmissing?from=1&to=0",
        "/universer-api/worktrees/wt-1/snapshot/2/unit/unit-1/rev/0",
        ...workspaceFixture.runtimeBlockIds.map(
          (blockId) =>
            `/universer-api/worktrees/wt-1/snapshot/2/unit/unit-1/block/${encodeURIComponent(blockId)}`,
        ),
      ].sort()) ||
    workspaceFixture.runtimeRequests.some(
      (request) => request.role !== "worker" || !/^\d+$/u.test(request.workerPid ?? ""),
    )
  ) {
    throw new Error(
      `Installed runtime fixture received unexpected worker requests: ${JSON.stringify(workspaceFixture.runtimeRequests)}`,
    );
  }
  await run(executable, ["daemon", "start", "--json"], installRoot, smokeEnv);
  await run(executable, ["daemon", "status", "--json"], installRoot, smokeEnv);
  const binding = createRequire(join(installRoot, "package.json"))(
    "@univerjs-pro/exchange-node-binding",
  );
  if (
    typeof binding.exchangeImportToSnapshot !== "function" ||
    typeof binding.exchangeExportSnapshot !== "function"
  ) {
    throw new Error("Installed package did not load the Exchange Node native binding");
  }
  await run(executable, ["daemon", "stop", "--json"], installRoot, smokeEnv);
  console.log("[package-smoke] installed tarball commands passed");
} finally {
  if (executable !== undefined && smokeEnv !== undefined) {
    spawnSync(executable, ["daemon", "stop", "--json"], {
      cwd: temporaryRoot,
      encoding: "utf8",
      env: smokeEnv,
      shell: process.platform === "win32",
    });
  }
  await workspaceFixture.close();
  await rm(temporaryRoot, { force: true, recursive: true });
}

async function run(command, args, cwd, env = process.env, input) {
  const child = spawn(command, args, {
    cwd,
    env,
    shell: process.platform === "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(input);
  const result = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    child.once("error", reject);
    child.once("exit", (status) => resolve({ status, stderr, stdout }));
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result;
}

async function startWorkspaceFixture() {
  const cookie = "workspace_session=package-smoke";
  const deviceCode = "package-smoke-device-code";
  const runtimeRequests = [];
  const runtimeFixture = await createRuntimeSnapshotFixture();
  const requests = {
    authorizationStarts: 0,
    authorizationExchanges: 0,
    whoami: 0,
    spaceList: 0,
    spaceBrowse: 0,
    worktreeList: 0,
    worktreeCreate: [],
    worktreeUpdate: 0,
    worktreeGet: 0,
    worktreeReady: 0,
    unitAdd: [],
    unitCreate: [],
    blobReserve: [],
    blobPut: 0,
    blobStatus: 0,
    blobComplete: 0,
    blobResource: 0,
    blobDownload: 0,
    assetSign: 0,
    assetContent: 0,
    logout: 0,
  };
  const assetServer = createServer((request, response) => {
    void handleAssetRequest(request, response, requests);
  });
  await new Promise((resolve, reject) => {
    assetServer.once("error", reject);
    assetServer.listen(0, "127.0.0.1", resolve);
  });
  const assetAddress = assetServer.address();
  if (assetAddress === null || typeof assetAddress === "string") {
    throw new Error("missing Asset fixture address");
  }
  const assetOrigin = `http://127.0.0.1:${assetAddress.port}`;
  const server = createServer((request, response) => {
    void handleWorkspaceRequest(request, response, {
      assetOrigin,
      cookie,
      deviceCode,
      requests,
      runtimeFixture,
      runtimeRequests,
    });
  });
  const collaboration = createCollaborationSocketFixture();
  server.on("upgrade", (request, socket) => collaboration.upgrade(request, socket));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing fixture address");
  return {
    close: async () => {
      collaboration.close();
      await Promise.all(
        [server, assetServer].map(
          async (fixtureServer) =>
            await new Promise((resolve, reject) =>
              fixtureServer.close((error) => (error ? reject(error) : resolve())),
            ),
        ),
      );
    },
    cookie,
    deviceCode,
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    runtimeBlockIds: runtimeFixture.blocks.map((block) => block.id),
    runtimeRequests,
  };
}

async function handleWorkspaceRequest(request, response, fixture) {
  if (request.method === "POST" && request.url === "/api/auth/cli/authorizations") {
    fixture.requests.authorizationStarts += 1;
    if (request.headers.cookie !== undefined) return writeJson(response, 400, {});
    return writeJson(response, 201, {
      deviceCode: fixture.deviceCode,
      expiresIn: 600,
      interval: 2,
      userCode: "ABCD-EFGH",
      verificationUriComplete: "/cli-login?userCode=ABCD-EFGH",
    });
  }
  if (
    request.method === "POST" &&
    request.url === "/api/auth/cli/authorizations/exchange"
  ) {
    fixture.requests.authorizationExchanges += 1;
    const body = await readJsonBody(request);
    if (request.headers.cookie !== undefined || body.deviceCode !== fixture.deviceCode) {
      return writeJson(response, 400, {});
    }
    if (fixture.requests.authorizationExchanges === 1) {
      return writeJson(response, 202, { status: "pending" });
    }
    return writeJson(
      response,
      200,
      {
        authenticated: true,
        user: { displayName: "Package Smoke", id: "package-smoke-user" },
      },
      { "set-cookie": `${fixture.cookie}; Path=/; HttpOnly` },
    );
  }
  if (request.headers.cookie !== fixture.cookie) {
    return writeJson(response, 401, { error: { code: "UNAUTHORIZED" } });
  }
  if (request.headers["x-univer-cli-sdk-role"] === "worker") {
    fixture.runtimeRequests.push({
      path: request.url,
      role: request.headers["x-univer-cli-sdk-role"],
      workerPid: request.headers["x-univer-cli-sdk-worker-pid"],
    });
  }
  if (request.method === "GET" && request.url === "/api/session") {
    fixture.requests.whoami += 1;
    return writeJson(response, 200, {
      authenticated: true,
      user: { displayName: "Package Smoke", id: "package-smoke-user" },
    });
  }
  if (request.method === "GET" && request.url === "/api/spaces") {
    fixture.requests.spaceList += 1;
    return writeJson(response, 200, {
      spaces: [{ id: "space-1", name: "Personal", type: "personal" }],
    });
  }
  if (request.method === "GET" && request.url === "/api/spaces/space-1/nodes") {
    fixture.requests.spaceBrowse += 1;
    return writeJson(response, 200, {
      breadcrumbs: [],
      navigationRootNodeId: null,
      nextCursor: null,
      nodes: [],
      parentNode: null,
      space: { id: "space-1", name: "Personal", type: "personal" },
    });
  }
  if (request.method === "GET" && request.url === "/api/worktrees?scope=active") {
    fixture.requests.worktreeList += 1;
    return writeJson(response, 200, { items: [worktree()] });
  }
  if (request.method === "POST" && request.url === "/api/worktrees") {
    fixture.requests.worktreeCreate.push(request.headers["idempotency-key"] ?? null);
    const body = await readJsonBody(request);
    if (JSON.stringify(body) !== JSON.stringify({ kind: "user", name: "Draft", summary: null })) {
      return writeJson(response, 400, {});
    }
    return writeJson(response, 200, worktree());
  }
  if (request.method === "PATCH" && request.url === "/api/worktrees/wt-1") {
    fixture.requests.worktreeUpdate += 1;
    const body = await readJsonBody(request);
    if (JSON.stringify(body) !== JSON.stringify({ name: "Renamed" })) {
      return writeJson(response, 400, {});
    }
    return writeJson(response, 200, { worktree: worktree({ name: "Renamed" }) });
  }
  if (request.method === "GET" && request.url === "/api/worktrees/wt-1") {
    fixture.requests.worktreeGet += 1;
    return writeJson(response, 200, { worktree: worktree({ units: [trunkUnit(), localUnit()] }) });
  }
  if (request.method === "GET" && request.url === "/universer-api/user/session-ticket") {
    return writeJson(response, 200, { ticket: "package-smoke-ticket" });
  }
  if (
    request.method === "GET" &&
    request.url === "/universer-api/worktrees/wt-1/snapshot/2/unit/unit-1/rev/0"
  ) {
    return writeJson(response, 200, {
      changesets: [],
      error: null,
      snapshot: fixture.runtimeFixture.snapshot,
    });
  }
  if (
    request.method === "GET" &&
    request.url ===
      "/universer-api/worktrees/wt-1/snapshot/2/unit/unit-1/fetchmissing?from=1&to=0"
  ) {
    return writeJson(response, 200, { changesets: [], error: null, latestRevision: 1 });
  }
  const blockPrefix = "/universer-api/worktrees/wt-1/snapshot/2/unit/unit-1/block/";
  if (request.method === "GET" && request.url?.startsWith(blockPrefix)) {
    const blockId = decodeURIComponent(request.url.slice(blockPrefix.length));
    const block = fixture.runtimeFixture.blocks.find((candidate) => candidate.id === blockId);
    return writeJson(
      response,
      block === undefined ? 404 : 200,
      block === undefined ? { error: { code: "NOT_FOUND" } } : { block, error: null },
    );
  }
  if (request.method === "POST" && request.url === "/api/worktrees/wt-1/ready") {
    fixture.requests.worktreeReady += 1;
    return writeJson(response, 200, { worktree: worktree({ state: "ready" }) });
  }
  if (request.method === "POST" && request.url === "/api/worktrees/wt-1/units") {
    const body = await readJsonBody(request);
    if (body.source === "trunk" && body.resourceId === "resource-1") {
      fixture.requests.unitAdd.push(request.headers["idempotency-key"] ?? null);
      return writeJson(response, 200, { unit: trunkUnit() });
    }
    if (
      body.source === "worktree" &&
      body.name === "Planning" &&
      body.targetSpaceId === "space-1" &&
      body.targetParentNodeId === null &&
      body.unitType === "doc"
    ) {
      fixture.requests.unitCreate.push(request.headers["idempotency-key"] ?? null);
      return writeJson(response, 200, { unit: localUnit() });
    }
    return writeJson(response, 400, {});
  }
  if (request.method === "POST" && request.url === "/api/blob-upload-sessions") {
    fixture.requests.blobReserve.push(request.headers["idempotency-key"] ?? null);
    const body = await readJsonBody(request);
    if (
      JSON.stringify(body) !==
      JSON.stringify({
        spaceId: "space-1",
        parentNodeId: null,
        name: "blob-source.bin",
        originalFilename: "blob-source.bin",
        byteSize: 10,
      })
    ) {
      return writeJson(response, 400, {});
    }
    return writeJson(response, 200, blobUploadEnvelope("waitingForUpload"));
  }
  if (
    request.method === "PUT" &&
    request.url === "/api/blob-upload-sessions/upload-blob/content"
  ) {
    fixture.requests.blobPut += 1;
    const body = await readBody(request);
    if (
      body !== "blob-bytes" ||
      request.headers["content-length"] !== "10" ||
      request.headers["content-type"] !== "application/octet-stream"
    ) {
      return writeJson(response, 400, {});
    }
    response.writeHead(200);
    return response.end();
  }
  if (request.method === "GET" && request.url === "/api/blob-upload-sessions/upload-blob") {
    fixture.requests.blobStatus += 1;
    return writeJson(response, 200, blobUploadEnvelope("uploaded"));
  }
  if (
    request.method === "POST" &&
    request.url === "/api/blob-upload-sessions/upload-blob/complete"
  ) {
    fixture.requests.blobComplete += 1;
    return writeJson(response, 200, {
      operation: blobOperation("completed"),
      node: blobNode(),
    });
  }
  if (request.method === "GET" && request.url === "/api/resources/resource-blob") {
    fixture.requests.blobResource += 1;
    const node = blobNode();
    return writeJson(response, 200, { node, resource: node.resource });
  }
  if (
    request.method === "GET" &&
    request.url === "/api/blob-resources/resource-blob/download"
  ) {
    fixture.requests.blobDownload += 1;
    response.writeHead(200, {
      "content-length": "10",
      "content-type": "application/octet-stream",
      etag: "blob-v1",
    });
    return response.end("blob-bytes");
  }
  if (
    request.method === "GET" &&
    request.url === "/universer-api/worktrees/wt-1/file/asset-1/sign-url"
  ) {
    fixture.requests.assetSign += 1;
    return writeJson(response, 200, {
      error: { code: 1, message: "" },
      url: `${fixture.assetOrigin}/asset-1`,
    });
  }
  if (request.method === "POST" && request.url === "/api/auth/logout") {
    fixture.requests.logout += 1;
    return writeJson(response, 200, {});
  }
  return writeJson(response, 404, { error: { code: "NOT_FOUND" } });
}

async function handleAssetRequest(request, response, requests) {
  requests.assetContent += 1;
  if (
    request.method !== "GET" ||
    request.url !== "/asset-1" ||
    request.headers.cookie !== undefined ||
    request.headers.origin !== undefined ||
    request.headers["x-univer-cli-sdk-role"] !== undefined
  ) {
    return writeJson(response, 400, {});
  }
  response.writeHead(200, {
    "content-length": "11",
    "content-type": "application/octet-stream",
    etag: "asset-v1",
  });
  response.end("asset-bytes");
}

async function readBody(request) {
  let source = "";
  for await (const chunk of request) source += chunk.toString("utf8");
  return source;
}

async function readJsonBody(request) {
  return JSON.parse(await readBody(request));
}

function writeJson(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(
    JSON.stringify(body, (_key, value) =>
      value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value,
    ),
  );
}

function worktree(overrides = {}) {
  return { id: "wt-1", name: "Draft", state: "draft", teamSpace: null, units: [], ...overrides };
}

function trunkUnit() {
  return unit({ draftHeadRevision: 1, unitId: "unit-1" });
}

function localUnit() {
  return unit({
    activationState: "waitingForMerge",
    change: "added",
    name: "Planning",
    nodeId: "node-local",
    resourceId: "resource-local",
    source: "worktree",
    target: { parentNodeId: null, spaceId: "space-1" },
    unitId: "unit-2",
    unitType: "doc",
  });
}

function unit(overrides) {
  return {
    activationState: "notApplicable",
    change: "unchanged",
    draftHeadRevision: 0,
    mergeResult: "pending",
    name: "Sheet",
    nodeId: "node-1",
    resourceId: "resource-1",
    source: "trunk",
    target: null,
    unitId: "unit-1",
    unitType: "sheet",
    ...overrides,
  };
}

function blobUploadEnvelope(state) {
  return {
    operation: blobOperation(state === "completed" ? "completed" : "pending"),
    upload: {
      byteSize: 10,
      createdAt: "2026-08-28T00:00:00.000Z",
      detectedMediaType: state === "waitingForUpload" ? null : "application/octet-stream",
      expiresAt: "2026-08-29T00:00:00.000Z",
      id: "upload-blob",
      name: "blob-source.bin",
      nodeId: "node-blob",
      operationId: "operation-blob",
      originalFilename: "blob-source.bin",
      receivedSize: state === "waitingForUpload" ? null : 10,
      resourceId: "resource-blob",
      sha256: null,
      state,
      updatedAt: "2026-08-28T00:00:00.000Z",
    },
    uploadTarget:
      state === "waitingForUpload"
        ? {
            contentUrl: "/api/blob-upload-sessions/upload-blob/content",
            method: "PUT",
          }
        : null,
  };
}

function blobOperation(state) {
  return {
    createdAt: "2026-08-28T00:00:00.000Z",
    error: null,
    id: "operation-blob",
    kind: "createBlobResource",
    result: state === "completed" ? { resourceId: "resource-blob" } : null,
    state,
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}

function blobNode() {
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
    id: "node-blob",
    name: "blob-source.bin",
    parentNodeId: null,
    resource: {
      availability: "ready",
      byteSize: 10,
      capabilities: { downloadContent: true, editContent: false, openContent: false },
      id: "resource-blob",
      kind: "blob",
      mediaType: "application/octet-stream",
    },
    spaceId: "space-1",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}

async function createRuntimeSnapshotFixture() {
  const blocks = [];
  const ok = { code: ErrorCode.OK, message: "" };
  const snapshotService = {
    saveSnapshot: async () => ({ error: ok }),
    updateSnapshot: async () => ({ error: ok }),
    saveSheetBlock: async (_context, request) => {
      if (request.block === undefined) throw new Error("Runtime smoke Snapshot block is missing");
      blocks.push(request.block);
      return { blockID: request.block.id, error: ok };
    },
  };
  const { snapshot } = await transformWorkbookDataToSnapshot(
    {},
    {
      appVersion: "0.25.0",
      id: "unit-1",
      locale: "enUS",
      name: "Runtime smoke",
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
    snapshotService,
  );
  return { blocks, snapshot };
}

function createCollaborationSocketFixture() {
  const sockets = new Set();
  return {
    close() {
      for (const socket of sockets) socket.destroy();
    },
    upgrade(request, socket) {
      socket.on("error", () => undefined);
      const key = request.headers["sec-websocket-key"];
      if (typeof key !== "string" || !request.url?.includes("/comb/connect")) {
        socket.destroy();
        return;
      }
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
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
      createCollaborationSocketPeer(socket);
    },
  };
}

async function assertInstalledRenderPage(installedPackageRoot) {
  const pageRoot = join(installedPackageRoot, "dist", "render-runtime");
  const index = await readFile(join(pageRoot, "index.html"), "utf8");
  const references = [...index.matchAll(/(?:src|href)="([^"]+)"/gu)].map(
    (match) => match[1],
  );
  if (references.length === 0 || references.some((reference) => !reference.startsWith("./"))) {
    throw new Error("Installed render page has an invalid asset manifest");
  }
  for (const reference of references) {
    if (!(await stat(join(pageRoot, reference))).isFile()) {
      throw new Error(`Installed render page asset is not a file: ${reference}`);
    }
  }
}

function createCollaborationSocketPeer(socket) {
  let buffer = Buffer.alloc(0);
  const send = (value) => {
    const payload = Buffer.from(JSON.stringify(value));
    const header =
      payload.length < 126
        ? Buffer.from([0x81, payload.length])
        : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
    socket.write(Buffer.concat([header, payload]));
  };
  const handleMessage = (message) => {
    if (message.cmd === CombCmd.HELLO) {
      send({
        cmd: CombCmd.HELLO,
        code: CmdRspCode.OK,
        infoRsp: { memberID: "package-smoke-member" },
        routeKey: "",
      });
    } else if (message.cmd === CombCmd.JOIN) {
      send({
        cmd: CombCmd.JOIN,
        code: CmdRspCode.OK,
        joinRsp: { roomInfos: {} },
        routeKey: message.routeKey,
      });
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
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }
    const opcode = first & 0x0f;
    if (opcode === 0x8) {
      socket.end(Buffer.from([0x88, 0x00]));
      return true;
    }
    if (opcode === 0x9) {
      socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
      return true;
    }
    if (opcode === 0x1) {
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
}

function stableKey(kind, ...parts) {
  const hash = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `workspace-${kind}-${hash}`;
}
