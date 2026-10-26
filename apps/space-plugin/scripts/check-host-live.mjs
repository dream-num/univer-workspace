import { writeEvidence } from './evidence-output.mjs';
import { connectHost } from './host-connection.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const host = await connectHost();
const checks = [];
await host.request('space/status'); // Fail clearly if the plugin has not activated.
const path = `${host.origin}/api/space/status`;
const init = {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: host.body('space/status', {}),
};
const anonymous = await fetch(path, init);
assert.equal(anonymous.status, 401);
checks.push('anonymous denied 401');
const cross = await fetch(path, {
  ...init,
  headers: { ...host.headers, origin: 'https://untrusted.example' },
});
assert.equal(cross.status, 403);
checks.push('foreign Origin denied 403');
const malformed = await fetch(path, {
  ...init,
  headers: host.headers,
  body: host.body('space/wrong', {}),
});
assert.equal(malformed.status, 400);
checks.push('mismatched RPC method denied 400');
const login = JSON.parse(
  await readFile(
    process.env.SPACE_TEST_LOGIN_FILE ?? '/tmp/task005-workspace-login.json',
    'utf8',
  ),
);
const prior = await host.request('space/status');
const configured = await host.request('space/configure', {
  endpoint: login.origin,
});
assert.equal(
  configured.state,
  prior.endpoint === login.origin ? prior.state : 'unauthenticated',
);
assert.equal(
  (
    await host.request('space/login', {
      username: login.username,
      password: login.password,
    })
  ).state,
  'connected',
);
checks.push('real Workspace endpoint and password authentication');
assert.ok(
  (await host.request('space/spaces')).spaces.some(
    (s) => s.id === login.spaceId,
  ),
);
checks.push('real Spaces');
const page = await host.request('space/nodes', { parent: login.folderId });
assert.equal(page.nodes.length, 2);
checks.push('real Folder');
const doc = await host.request('space/content', { node: login.doc.id });
assert.match(doc.data.body.dataStream, /SPACE-ORBIT-7419/);
assert.ok(doc.data.body.sectionBreaks.length);
checks.push('real full Document UnitData');
const sheet = await host.request('space/content', { node: login.sheet.id });
assert.equal(sheet.data.sheets.budget.cellData[3][1].v, 4270);
checks.push('real full Sheet UnitData and block materialization');
const recent = await host.request('space/recent');
assert.ok(recent.items.some((i) => i.node.id === login.doc.id));
checks.push('server recent-resources');
assert.ok(!JSON.stringify({ doc, sheet, recent }).includes(login.cookie));
checks.push('no upstream cookie in content');
await writeEvidence('desktop-host-api.json', {
  at: new Date().toISOString(),
  origin: host.origin,
  carrier: 'official Electron-owned Host API; not Electron renderer UX',
  checks,
  document: {
    nodeId: doc.nodeId,
    unitId: doc.unitId,
    revision: doc.revision,
    sha256: doc.sha256,
  },
  sheet: {
    nodeId: sheet.nodeId,
    unitId: sheet.unitId,
    revision: sheet.revision,
    sha256: sheet.sha256,
  },
});
console.log(JSON.stringify({ passed: checks.length, checks }));
