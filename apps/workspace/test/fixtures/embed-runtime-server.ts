/** Disposable production HTTP/OT fixture. Snapshot paths are local SDK save() exports. */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourcesRepository } from "../../server/src/modules/resources/resources.repository.js";
import { createWorkspaceApplication } from "../../server/src/app.js";

const directory = mkdtempSync(join(tmpdir(), "workspace-embed-runtime-"));
process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
const port = Number(process.env.PORT ?? 3092);
const application = createWorkspaceApplication({
  host: "127.0.0.1",
  port,
  databaseFilename: join(directory, "product.sqlite"),
  collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
  blobDirectory: join(directory, "blobs"),
  secureCookies: false,
  sessionTtlMs: 3_600_000,
  passwordAuthEnabled: true,
  oauthClients: null,
});
await application.initialize();
const issued = await application.identity.registerWithPassword({
  username: "embed-reviewer",
  displayName: "Embed reviewer",
  password: randomUUID(),
});
const userId = issued.view.user.id;
const space = application.spaces.list(userId).spaces[0]!;
const sourceBase = JSON.parse(readFileSync(process.env.EMBED_BASE_SNAPSHOT!, "utf8"));
const sourceDoc = JSON.parse(readFileSync(process.env.EMBED_DOC_SNAPSHOT!, "utf8"));
const repository = new ResourcesRepository(application.database);
const baseUnit = randomUUID();
const docUnit = randomUUID();
async function seed(
  unitType: "base" | "doc" | "sheet" | "slide" | "board",
  unitId: string,
  name: string,
  data: unknown,
) {
  const operationId = randomUUID();
  repository.reserveCreateResource({
    operationId,
    actorUserId: userId,
    createdAt: Date.now(),
    payload: {
      kind: "univer",
      spaceId: space.id,
      parentNodeId: null,
      name,
      unitType,
      nodeId: randomUUID(),
      resourceId: randomUUID(),
      unitId,
      ...(data === undefined ? {} : { initialData: data }),
    },
  });
  repository.markFailed(operationId, { code: "FIXTURE", message: "Seed reserved" }, Date.now());
  const result = await application.resources.retry(userId, operationId);
  if (result.state !== "completed") throw new Error(`${name}: ${JSON.stringify(result)}`);
  return application.resources.getByUnit(userId, unitId).node;
}
const base = await seed(
  "base",
  baseUnit,
  "License analytics Base",
  JSON.parse(JSON.stringify(sourceBase).replaceAll(sourceBase.id, baseUnit)),
);
const doc = await seed(
  "doc",
  docUnit,
  "License analytics PRD",
  JSON.parse(
    JSON.stringify(sourceDoc).replaceAll(sourceBase.id, baseUnit).replaceAll(sourceDoc.id, docUnit),
  ),
);
if (base.resource?.kind !== "univer" || doc.resource?.kind !== "univer")
  throw new Error("Missing fixture Units");
const worktree = (
  await application.worktrees.create(userId, randomUUID(), {
    kind: "user",
    name: "Review embedded analytics Base",
    summary: null,
  })
).body;
for (const node of [doc, base]) {
  if (node.resource?.kind !== "univer") continue;
  await application.worktrees.addUnit(userId, worktree.id, randomUUID(), {
    source: "trunk",
    resourceId: node.resource.id,
  });
}
const plainDoc = await seed("doc", randomUUID(), "Embedded document source", {
  body: { dataStream: "Embedded document content\r\n" },
});
const sourceIds: Record<string, string> = {};
for (const kind of ["sheet", "slide", "board"] as const) {
  const node = await seed(kind, randomUUID(), `Embedded ${kind} source`, undefined);
  if (node.resource?.kind !== "univer") throw new Error("Missing source Unit");
  sourceIds[`matrix-source-${kind}`] = node.resource.unitId;
}
const matrix: Array<{ name: string; nodeId: string; unitId: string }> = [];
const createEmbedMatrix = createRequire(import.meta.url)("./create-embed-matrix.cjs");
for (const item of createEmbedMatrix(baseUnit, plainDoc.resource!.unitId)) {
  const unitId = randomUUID();
  let serialized = JSON.stringify(item.data).replaceAll(item.unitId, unitId);
  for (const [oldId, newId] of Object.entries(sourceIds))
    serialized = serialized.replaceAll(oldId, newId);
  const node = await seed(item.kind, unitId, item.name, JSON.parse(serialized));
  matrix.push({ name: item.name, nodeId: node.id, unitId });
}
const server = createServer((request, response) => {
  if (request.url?.startsWith("/fixture-login")) {
    response.writeHead(302, {
      "Set-Cookie": `${application.identity.cookieName}=${issued.cookieValue}; HttpOnly; SameSite=Lax; Path=/`,
      Location: `/nodes/${doc.id}`,
    });
    response.end();
    return;
  }
  application.app(request, response);
});
application.attachWebSocket(server);
await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
const info = {
  origin: `http://127.0.0.1:${port}`,
  docNode: doc.id,
  baseNode: base.id,
  docUnit: doc.resource.unitId,
  baseUnit: base.resource.unitId,
  worktree: worktree.id,
  matrix,
};
writeFileSync(join(directory, "fixture.json"), JSON.stringify(info));
console.log(
  `Embed fixture ready: ${info.origin}/fixture-login\nFixture info: ${join(directory, "fixture.json")}`,
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, async () => {
    await application.closeRealtime();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await application.close();
    rmSync(directory, { recursive: true, force: true });
  });
