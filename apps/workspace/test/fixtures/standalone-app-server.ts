/** Disposable, loopback-only browser fixture. Optional argument: a self-contained .univer.html file. */
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { createWorkspaceApplication } from "../../server/src/app.js";

const directory = mkdtempSync(join(tmpdir(), "workspace-standalone-"));
const application = createWorkspaceApplication({
  host: "127.0.0.1", port: 3092,
  databaseFilename: join(directory, "product.sqlite"),
  collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
  blobDirectory: join(directory, "blobs"), secureCookies: false, sessionTtlMs: 3_600_000, passwordAuthEnabled: true,
}, {unitStore: {async createUnit(input) {return {unitId: input.unitId, headRevision: 1};}}});
const issued = await application.identity.registerWithPassword({username: "standalone-owner", displayName: "Fixture", password: randomUUID()});
const userId = issued.view.user.id;
const space = application.spaces.list(userId).spaces[0]!;
async function publish(html: string, shared = true) {
  const bytes = Buffer.from(html);
  const {body} = application.blobs.createUpload(userId, randomUUID(), {spaceId: space.id, parentNodeId: null,
    name: "Standalone.univer.html", originalFilename: "Standalone.univer.html", byteSize: bytes.length});
  await application.blobs.upload(userId, body.upload.id, String(bytes.length), Readable.from([bytes]));
  await application.blobs.complete(userId, body.upload.id);
  if (shared) application.permissions.updateNodeLinkSharing(userId, body.upload.nodeId, {enabled: true, role: "viewer"});
  return `http://127.0.0.1:3092/apps/${body.upload.nodeId}/run`;
}
const probe = await publish(`<!doctype html><title>Standalone sandbox probe</title><h1>Standalone sandbox probe</h1>
<a href="#second">Second section</a><button onclick="history.replaceState(null,'',location.pathname+'?changed=1#replaced'); report()">Replace URL</button><pre id="report"></pre><script>
const result={topLevel:top===self,iframes:document.querySelectorAll('iframe').length};
try{result.cookie=document.cookie}catch{result.cookie='blocked'}
try{result.storage=localStorage.getItem('probe')}catch{result.storage='blocked'}
function report(){document.getElementById('report').textContent=JSON.stringify({...result,search:location.search,hash:location.hash},null,2)}
addEventListener('hashchange',report);report();
fetch('/api/session').then(()=>result.fetch='unexpectedly allowed',()=>result.fetch='blocked').finally(report);
</script>`);
console.log(`Probe: ${probe}?entry=1#first`);
if (process.argv[2]) console.log(`App: ${await publish(readFileSync(process.argv[2], "utf8"))}`);
const privateEntry = await publish('<!doctype html><title>Private entry</title><h1>Private App authenticated</h1><p id="entry"></p><script>document.getElementById("entry").textContent=location.search+location.hash</script>', false);
console.log(`Private: ${privateEntry}?prd=13#refundFaq`);
const server = createServer((request, response) => {
  if (request.url === '/fixture-login') {
    response.writeHead(303, {'Set-Cookie': `${application.identity.cookieName}=${issued.cookieValue}; HttpOnly; SameSite=Lax; Path=/`, Location: probe+'?authenticated=1#first'});
    response.end();
    return;
  }
  application.app(request, response);
});
await new Promise<void>(resolve => server.listen(3092, "127.0.0.1", resolve));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await application.close();
  rmSync(directory, {recursive: true, force: true});
});
