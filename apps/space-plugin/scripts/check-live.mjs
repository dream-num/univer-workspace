import { writeEvidence } from './evidence-output.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WorkspaceConnection } from '../lib/workspace.js';
const login = JSON.parse(await readFile(process.env.SPACE_TEST_LOGIN_FILE ?? '/tmp/task004-workspace-login.json', 'utf8'));
const workspace = new WorkspaceConnection();
const checks=[];
try {
 assert.equal((await workspace.status()).state, 'unconfigured'); checks.push('unconfigured');
 workspace.configure(login.origin);
 assert.equal((await workspace.status()).state, 'unauthenticated'); checks.push('unauthenticated');
 assert.equal((await workspace.login(login.username, login.password)).state, 'connected'); checks.push('password authentication');
 const spaces=await workspace.json('/api/spaces'); assert.ok(spaces.spaces.some(s=>s.id===login.spaceId)); checks.push('real Spaces');
 const page=await workspace.json(`/api/nodes/${login.folderId}/children`); assert.equal(page.nodes.length,2); checks.push('real Folder with doc/sheet');
 const document=await workspace.read(login.doc.id);
 assert.match(document.content.text,/SPACE-ORBIT-7419/); assert.equal(document.revision,1); checks.push('materialized Document text');
 const sheet=await workspace.read(login.sheet.id);
 assert.ok(sheet.content.sheets[0].cells.some(c=>c.value==='4270')); checks.push('materialized Sheet cells');
 assert.equal(JSON.stringify({document,sheet}).includes(login.cookie), false); checks.push('no Workspace cookie in content');
 workspace.configure('http://127.0.0.1:1'); assert.equal((await workspace.status()).state,'network-error'); checks.push('network-error');
 workspace.configure(login.origin); assert.equal((await workspace.status()).state,'unauthenticated'); checks.push('endpoint change revokes credential');
 const report={at:new Date().toISOString(),server:login.origin,checks,document,sheet};
 await writeEvidence('live-api.json', report);
 console.log(JSON.stringify({passed:checks.length,checks}));
} finally { await workspace.dispose(); }
