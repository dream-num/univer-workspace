import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import {
  ExchangeFormat,
  exportToBuffer,
  importBuffer,
} from "@univerjs-pro/exchange-node";
import {
  type IWorkbookData,
  UniverInstanceType,
} from "@univerjs/core";
import { ErrorCode, UniverType } from "@univerjs/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";
import { blankUnitData } from "../../server/src/integrations/univer/unit-store.js";

const applications: WorkspaceApplication[] = [];
const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(
    applications.splice(0).map((application) => application.close())
  );
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Universer Exchange protocol", () => {
  it("imports an Office file as a product Resource and exports it for viewers", async () => {
    const { application, origin } = await startApplication();
    const owner = await register(application, "exchange-owner");
    const viewer = await register(application, "exchange-viewer");
    const outsider = await register(application, "exchange-outsider");
    const source = await workbookFile("Revenue", "quarterly-plan");
    const upload = await uploadExchangeFile(origin, owner.cookie, source);

    expect(upload.response.status).toBe(201);
    expect(upload.body.FileId).toEqual(expect.any(String));
    expect(count(application, "univer_assets")).toBe(0);

    const importedTask = await startTask(
      origin,
      owner.cookie,
      `/universer-api/exchange/${UniverType.UNIVER_SHEET}/import`,
      { fileID: upload.body.FileId, outputType: 1 }
    );
    const imported = await waitForTask(origin, owner.cookie, importedTask);
    expect(imported.error.code).toBe(ErrorCode.OK);
    expect(imported.status).toBe("done");
    expect(imported.import?.unitID).toEqual(expect.any(String));

    const access = application.access.resolveUnit(
      owner.userId,
      imported.import!.unitID
    );
    expect(access).toMatchObject({
      kind: "univer",
      unitType: "sheet",
      node: {
        name: "quarterly-plan",
        parentNodeId: null,
        spaceType: "personal",
      },
    });
    expect(count(application, "nodes")).toBe(1);
    expect(count(application, "resources")).toBe(1);
    expect(count(application, "univer_resources")).toBe(1);

    await expectTaskStart(
      origin,
      outsider.cookie,
      `/universer-api/exchange/${UniverType.UNIVER_SHEET}/export`,
      {
        unitID: imported.import!.unitID,
        type: UniverInstanceType.UNIVER_SHEET,
        format: ExchangeFormat.XLSX,
      },
      404
    );

    application.permissions.upsertNodeGrant(
      owner.userId,
      access!.node.id,
      viewer.userId,
      { role: "viewer" }
    );
    const exportedTask = await startTask(
      origin,
      viewer.cookie,
      `/universer-api/exchange/${UniverType.UNIVER_SHEET}/export`,
      {
        unitID: imported.import!.unitID,
        type: UniverInstanceType.UNIVER_SHEET,
        format: ExchangeFormat.XLSX,
      }
    );
    const exported = await waitForTask(origin, viewer.cookie, exportedTask);
    expect(exported).toMatchObject({
      error: { code: ErrorCode.OK },
      status: "done",
      export: { fileID: expect.any(String) },
    });

    const hiddenTask = await fetch(
      `${origin}/universer-api/exchange/task/${exportedTask}`,
      { headers: { cookie: outsider.cookie } }
    );
    expect(hiddenTask.status).toBe(200);
    await expect(hiddenTask.json()).resolves.toMatchObject({
      error: { code: ErrorCode.NOT_FOUND },
      status: "failed",
    });
    expect(
      (
        await fetch(
          `${origin}/universer-api/file/${exported.export!.fileID}/sign-url`,
          { headers: { cookie: outsider.cookie } }
        )
      ).status
    ).toBe(404);

    const downloaded = await downloadArtifact(
      origin,
      viewer.cookie,
      exported.export!.fileID
    );
    const workbook = await importBuffer(downloaded, {
      type: UniverInstanceType.UNIVER_SHEET,
      fileName: "exported.xlsx",
    });
    const worksheet = workbook.sheets[workbook.sheetOrder[0]!];
    expect(worksheet?.cellData?.[0]?.[0]?.v).toBe("Revenue");
  }, 20_000);

  it("round-trips the client JSON snapshot flow", async () => {
    const { application, origin } = await startApplication();
    const owner = await register(application, "exchange-json-owner");
    const source = await workbookFile("JSON round trip", "snapshot-source");
    const uploaded = await uploadExchangeFile(origin, owner.cookie, source);
    const importedTask = await startTask(
      origin,
      owner.cookie,
      `/universer-api/exchange/${UniverType.UNIVER_SHEET}/import`,
      { fileID: uploaded.body.FileId, outputType: 2 }
    );
    const imported = await waitForTask(origin, owner.cookie, importedTask);
    expect(imported).toMatchObject({
      error: { code: ErrorCode.OK },
      status: "done",
      import: { outputType: 2, jsonID: expect.any(String) },
    });
    expect(count(application, "resources")).toBe(0);

    const snapshotBuffer = await downloadArtifact(
      origin,
      owner.cookie,
      imported.import!.jsonID
    );
    const snapshotJson = JSON.parse(snapshotBuffer.toString("utf8")) as {
      readonly snapshot: { readonly workbook?: { readonly originalMeta?: unknown } };
      readonly sheetBlocks: Readonly<Record<string, { readonly data?: unknown }>>;
    };
    expect(snapshotJson.snapshot.workbook?.originalMeta).toEqual(
      expect.any(String)
    );
    expect(Object.values(snapshotJson.sheetBlocks)[0]?.data).toEqual(
      expect.any(String)
    );

    const compressed = deflateRawSync(snapshotBuffer);
    const compressedUpload = await uploadExchangeFile(
      origin,
      owner.cookie,
      new File([compressed], "snapshot.json", {
        type: "application/json",
      }),
      { declaredSize: snapshotBuffer.byteLength, flate: true }
    );
    expect(compressedUpload.response.status).toBe(201);

    const exportedTask = await startTask(
      origin,
      owner.cookie,
      `/universer-api/exchange/${UniverType.UNIVER_SHEET}/export`,
      {
        jsonID: compressedUpload.body.FileId,
        type: UniverInstanceType.UNIVER_SHEET,
        format: ExchangeFormat.XLSX,
      }
    );
    const exported = await waitForTask(origin, owner.cookie, exportedTask);
    const workbook = await importBuffer(
      await downloadArtifact(
        origin,
        owner.cookie,
        exported.export!.fileID
      ),
      {
        type: UniverInstanceType.UNIVER_SHEET,
        fileName: "round-trip.xlsx",
      }
    );
    const worksheet = workbook.sheets[workbook.sheetOrder[0]!];
    expect(worksheet?.cellData?.[0]?.[0]?.v).toBe("JSON round trip");
  }, 20_000);

  it.each([
    {
      unitType: "doc" as const,
      protocolType: UniverType.UNIVER_DOC,
      instanceType: UniverInstanceType.UNIVER_DOC,
      format: ExchangeFormat.DOCX,
    },
    {
      unitType: "slide" as const,
      protocolType: UniverType.UNIVER_SLIDE,
      instanceType: UniverInstanceType.UNIVER_SLIDE,
      format: ExchangeFormat.PPTX,
    },
    {
      unitType: "base" as const,
      protocolType: UniverType.UNIVER_BASE,
      instanceType: UniverInstanceType.UNIVER_BASE,
      format: ExchangeFormat.XLSX,
    },
  ])("imports $unitType Office content", async (fixture) => {
    const { application, origin } = await startApplication();
    const owner = await register(
      application,
      `exchange-${fixture.unitType}-owner`
    );
    const source = await officeFile(fixture);
    const uploaded = await uploadExchangeFile(origin, owner.cookie, source);
    const taskId = await startTask(
      origin,
      owner.cookie,
      `/universer-api/exchange/${fixture.protocolType}/import`,
      { fileID: uploaded.body.FileId, outputType: 1 }
    );
    const imported = await waitForTask(origin, owner.cookie, taskId);
    expect(imported).toMatchObject({
      error: { code: ErrorCode.OK },
      status: "done",
      import: { unitID: expect.any(String) },
    });
    expect(
      application.access.resolveUnit(owner.userId, imported.import!.unitID)
    ).toMatchObject({
      kind: "univer",
      unitType: fixture.unitType,
    });
  });
});

async function startApplication(): Promise<{
  readonly application: WorkspaceApplication;
  readonly origin: string;
}> {
  const directory = mkdtempSync(join(tmpdir(), "workspace-exchange-"));
  directories.push(directory);
  const application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 0,
    databaseFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
    blobDirectory: join(directory, "objects"),
    secureCookies: false,
    sessionTtlMs: 60_000,
  });
  applications.push(application);
  const server = createServer(application.app);
  servers.push(server);
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server address is missing.");
  }
  return {
    application,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

async function register(
  application: WorkspaceApplication,
  username: string
): Promise<{ readonly userId: string; readonly cookie: string }> {
  const issued = await application.identity.registerWithPassword({
    username,
    displayName: username,
    password: "correct horse battery staple",
  });
  return {
    userId: issued.view.user.id,
    cookie: `${application.identity.cookieName}=${issued.cookieValue}`,
  };
}

async function workbookFile(value: string, name: string): Promise<File> {
  const created = blankUnitData({
    unitId: randomUUID(),
    unitType: "sheet",
    name,
  });
  const workbook = created.data as IWorkbookData;
  const worksheet = workbook.sheets[workbook.sheetOrder[0]!];
  if (!worksheet) throw new Error("Fixture worksheet is missing.");
  worksheet.cellData = { 0: { 0: { v: value } } };
  const output = await exportToBuffer(workbook, {
    type: UniverInstanceType.UNIVER_SHEET,
    format: ExchangeFormat.XLSX,
  });
  return new File([output], `${name}.xlsx`, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function officeFile(fixture: {
  readonly unitType: "doc" | "slide" | "base";
  readonly instanceType: UniverInstanceType;
  readonly format: ExchangeFormat;
}): Promise<File> {
  const created = blankUnitData({
    unitId: randomUUID(),
    unitType: fixture.unitType,
    name: `Imported ${fixture.unitType}`,
  });
  const convert = exportToBuffer as unknown as (
    data: unknown,
    options: {
      readonly type: UniverInstanceType;
      readonly format: ExchangeFormat;
    }
  ) => Promise<Buffer>;
  const output = await convert(created.data, {
    type: fixture.instanceType,
    format: fixture.format,
  });
  return new File([output], `import.${fixture.format}`);
}

async function uploadExchangeFile(
  origin: string,
  cookie: string,
  file: File,
  options: {
    readonly declaredSize?: number;
    readonly flate?: boolean;
  } = {}
): Promise<{
  readonly response: Response;
  readonly body: { readonly FileId: string };
}> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(
    `${origin}/universer-api/stream/file/upload?size=${options.declaredSize ?? file.size}&source=1&flate=${options.flate ?? false}`,
    { method: "POST", headers: { cookie }, body: form }
  );
  return {
    response,
    body: (await response.json()) as { readonly FileId: string },
  };
}

async function startTask(
  origin: string,
  cookie: string,
  path: string,
  body: unknown
): Promise<string> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  const result = (await response.json()) as { readonly taskID?: string };
  expect(result.taskID).toEqual(expect.any(String));
  return result.taskID!;
}

async function expectTaskStart(
  origin: string,
  cookie: string,
  path: string,
  body: unknown,
  expectedStatus: number
): Promise<void> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(expectedStatus);
}

interface TaskResponse {
  readonly error: { readonly code: number; readonly message: string };
  readonly status: string;
  readonly import?: {
    readonly outputType: number;
    readonly unitID: string;
    readonly jsonID: string;
  };
  readonly export?: { readonly fileID: string; readonly fileUrl: string };
}

async function waitForTask(
  origin: string,
  cookie: string,
  taskId: string
): Promise<TaskResponse> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(
      `${origin}/universer-api/exchange/task/${taskId}`,
      { headers: { cookie } }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as TaskResponse;
    if (body.status !== "pending") return body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Exchange task ${taskId} did not finish.`);
}

async function downloadArtifact(
  origin: string,
  cookie: string,
  fileId: string
): Promise<Buffer> {
  const signed = await fetch(
    `${origin}/universer-api/file/${fileId}/sign-url`,
    { headers: { cookie } }
  );
  expect(signed.status).toBe(200);
  const body = (await signed.json()) as { readonly url: string };
  const content = await fetch(`${origin}${body.url}`, {
    headers: { cookie },
  });
  expect(content.status).toBe(200);
  return Buffer.from(await content.arrayBuffer());
}

function count(application: WorkspaceApplication, table: string): number {
  return (
    application.database.connection
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { readonly count: number }
  ).count;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
