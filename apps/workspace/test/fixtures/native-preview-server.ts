/** Isolated manual browser fixture. Run from apps/workspace after build:web.
 * Uses disposable databases and the production HTTP/OT server. */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createWorkspaceApplication } from "../../server/src/app.js";
const directory = mkdtempSync(join(tmpdir(), "workspace-native-preview-"));
const application = createWorkspaceApplication({ host: "127.0.0.1", port: 3091,
  databaseFilename: join(directory, "product.sqlite"), collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
  blobDirectory: join(directory, "blobs"), secureCookies: false, sessionTtlMs: 3_600_000,
  passwordAuthEnabled: true, oauthClients: null });
await application.initialize();
const password = randomUUID();
const issued = await application.identity.registerWithPassword({ username: "preview-owner", displayName: "Preview owner", password });
const userId = issued.view.user.id;
const space = application.spaces.list(userId).spaces[0]!;
const units: Record<string, string> = {};
for (const unitType of ["sheet", "doc", "slide"] as const) {
  const result = await application.resources.create(userId, randomUUID(), {
    kind: "univer", name: `Native ${unitType}`, spaceId: space.id, parentNodeId: null, unitType,
  });
  if (result.body.node?.resource?.kind === "univer") units[unitType] = result.body.node.resource.unitId;
}
const server = createServer(application.app);
application.attachWebSocket(server);
await new Promise<void>(resolve => server.listen(3091, "127.0.0.1", resolve));
const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
const snapshot = await (await fetch(`http://127.0.0.1:3091/universer-api/snapshot/2/unit/${units.sheet}/rev/0`, { headers: { cookie } })).json();
const sheetId = snapshot.snapshot.workbook.sheetOrder[0];
const cell = `${units.sheet}:${sheetId}:A1`;
const other = await application.identity.registerWithPassword({ username: "private-owner", displayName: "Private owner", password: randomUUID() });
const privateSpace = application.spaces.list(other.view.user.id).spaces[0]!;
const privateDoc = await application.resources.create(other.view.user.id, randomUUID(), {
  kind: "univer", name: "Private document", spaceId: privateSpace.id, parentNodeId: null, unitType: "doc",
});
const privateUnit = privateDoc.body.node?.resource?.kind === "univer" ? privateDoc.body.node.resource.unitId : "missing";
const html = `<!doctype html><html lang="en"><head><title>Connected workspace</title><style>
body{margin:0;padding:24px;background:#0b1727;color:#dceaf5;font:16px system-ui}button{padding:10px 16px;margin:4px;border:1px solid #35566a;border-radius:8px;background:#173442;color:#b5f1db;cursor:pointer}#slot{height:650px;margin-top:16px}#status{color:#9cbac9}header{position:sticky;top:0;background:#0b1727;padding:8px}h1{margin:8px 0 18px}
</style></head><body><header><h1>Connected workspace</h1><p>One HTML page. Native Office files. Independent source permissions.</p>
${Object.entries(units).map(([kind,id]) => `<button id="${kind}" onclick="univerWorkspace.showUnit('${id}',document.getElementById('slot'))">${kind}</button>`).join("")}
<button id="denied" onclick="univerWorkspace.showUnit('${privateUnit}',document.getElementById('slot'))">Unavailable file</button>
<button id="close" onclick="univerWorkspace.hideUnit()">Close</button><button id="share" onclick="univerWorkspace.share()">Share</button>
<p><label>Shared A1 <input id="assumption" type="number" data-univer-cell-model="${cell}"></label> <span id="readout" data-univer-cell-text="${cell}"></span></p>
<button id="locate" onclick="univerWorkspace.showUnit('${units.sheet}',document.getElementById('slot'),{focus:{kind:'sheet',sheetId:'${sheetId}',range:'B20'}})">Locate B20</button>
<p id="status" role="status">Choose a file</p></header><div id="slot"></div><script>
addEventListener('workspace-preview-status',e=>document.getElementById('status').textContent=e.detail.status);
addEventListener('workspace-preview-closed',()=>document.getElementById('status').textContent='closed');
</script></body></html>`;
const bytes = Buffer.from(html);
const upload = application.blobs.createUpload(userId, randomUUID(), { spaceId: space.id, parentNodeId: null,
  name: "Connected workspace.univer.html", originalFilename: "Connected workspace.univer.html", byteSize: bytes.length, declaredMediaType: "text/html" });
await application.blobs.upload(userId, upload.body.upload.id, String(bytes.length), Readable.from([bytes]));
const result = await application.blobs.complete(userId, upload.body.upload.id);
application.permissions.updateNodeLinkSharing(userId, result.body.node!.id, { enabled: true, role: "viewer" });
const info = { sheetId, origin: "http://127.0.0.1:3091", nodeId: result.body.node?.id, units,
  cookieName: application.identity.cookieName, cookieValue: issued.cookieValue, username: "preview-owner", password };
writeFileSync(join(directory, "session.json"), JSON.stringify(info), { mode: 0o600 });
console.log(`Fixture ready: ${info.origin}/nodes/${info.nodeId}\nSession file: ${join(directory, "session.json")}`);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, async () => {
  await application.closeRealtime(); server.close(); await application.close();
  rmSync(directory, { recursive: true, force: true });
});
