import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { WorkspaceConnection } from '../lib/workspace.js';
import { ToolBindings } from '../lib/tools.js';
import { writeEvidence } from './evidence-output.mjs';
const login=JSON.parse(await readFile(process.env.SPACE_TEST_LOGIN_FILE ?? '/tmp/task005-workspace-login.json','utf8'));
const other=JSON.parse(await readFile(process.env.SPACE_OTHER_LOGIN_FILE ?? '/tmp/task004-workspace-login.json','utf8'));
const workspace=new WorkspaceConnection();const bindings=new ToolBindings(workspace);const checks=[];
try {
 workspace.configure(login.origin);await assert.rejects(bindings.bind('s1',login.doc.id));checks.push('unauthenticated association denied');
 await workspace.login(login.username,login.password);
 const index=await workspace.index(new AbortController().signal);assert.equal(index.complete,true);assert.ok(index.nodes.some(n=>n.id===login.doc.id));assert.ok(index.nodes.some(n=>n.id===login.folderId));assert.ok(index.nodes.every(n=>!('content' in n)));checks.push('ACL-scoped complete All metadata without document bodies');
 const status=await workspace.status();await bindings.bind('s1',login.doc.id);
 const read=await bindings.inspect('s1',login.doc.id,new AbortController().signal);assert.equal(read.userId,status.user.id);assert.ok(read.lines.some(l=>l.text.includes('SPACE-ORBIT-7419')));checks.push('real current-user tool read');
 await assert.rejects(bindings.inspect('unbound',login.doc.id,new AbortController().signal));checks.push('cross-Session grant denied');
 await assert.rejects(bindings.inspect('s1',login.doc.id,new AbortController().signal,-1,400));checks.push('read bounds validated');
 await assert.rejects(bindings.bind('s1',other.doc.id),error=>[403,404].includes(error.status));checks.push('real Server ACL denies other account resource');
 await workspace.login(other.username,other.password);await assert.rejects(bindings.scope('s1'));checks.push('current-user change invalidates prior grant');
 await writeEvidence('tools-live.json',{at:new Date().toISOString(),checks,read:{file:read.file,userId:read.userId,revision:read.revision,sha256:read.sha256},allMetadataCount:index.nodes.length});
 console.log(JSON.stringify({passed:checks.length,checks}));
} finally {bindings.clear();await workspace.dispose();}
