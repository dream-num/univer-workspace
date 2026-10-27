// Node protocol + real Server regression. Desktop UI acceptance is separate.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import{WorkspaceConnection}from'../lib/workspace.js';
import{WorkspaceOAuth}from'../lib/oauth.js';
import{authorizeWorkspace}from'./host-connection.mjs';
const fixture=JSON.parse(fs.readFileSync(process.env.SPACE_TEST_LOGIN_FILE,'utf8'));
const output=process.env.SPACE_EVIDENCE_DIR;
if(!output)throw new Error('SPACE_EVIDENCE_DIR is required.');
fs.mkdirSync(output,{recursive:true});
const workspace=new WorkspaceConnection();let saved;
const auth=new WorkspaceOAuth(workspace,{read:async()=>saved,write:async v=>{saved=v}},()=>{});
const host={request:async(operation,payload={})=>{
 switch(operation){case'space/configure':return auth.configure(payload.endpoint);case'space/oauth-start':return auth.start(false);case'space/oauth-cancel':auth.cancel();return auth.status();case'space/status':return auth.status();default:throw Error('Unexpected test operation')}
}};
const checks=[];const matrix=[];
try{
 const status=await authorizeWorkspace(host,fixture);assert.equal(status.state,'connected');checks.push('Real isolated Server consent + PKCE exchange + loopback callback + authoritative session verification');
 const signal=AbortSignal.timeout(120000);const stamp=Date.now();
 const folder=await workspace.create({kind:'folder',name:`TASK011A API Folder ${stamp}`,space:fixture.spaceId,parent:'',key:randomUUID()},signal);
 for(const kind of ['doc','sheet','slide','board','base','site']){
  const created=await workspace.create({kind,name:`TASK011A API ${kind} ${stamp}`,space:fixture.spaceId,parent:'',key:randomUUID()},signal);
  const id=created.node.id;const before=await workspace.read(id);const name=`TASK011A API ${kind} renamed ${stamp}`;
  await workspace.mutate({action:'rename',id,name},signal);
  await workspace.mutate({action:'move',id,parent:folder.node.id},signal);
  const moved=await workspace.read(id);assert.equal(moved.resourceId,before.resourceId);assert.equal(moved.unitId,before.unitId);assert.equal(moved.sourceSha256??moved.sha256,before.sourceSha256??before.sha256);assert.equal(moved.name,name);
  await workspace.mutate({action:'delete',id},signal);
  const trash=await workspace.trash(signal);const batch=trash.items.find(x=>x.root.id===id);assert.ok(batch);
  await workspace.mutate({action:'restore',id:batch.id},signal);
  const restored=await workspace.read(id);assert.equal(restored.sourceSha256??restored.sha256,before.sourceSha256??before.sha256);assert.equal(restored.unitId,before.unitId);
  matrix.push({kind,nodeId:id,unitId:before.unitId,resourceId:before.resourceId,contentSha256:before.sourceSha256??before.sha256,create:true,rename:true,move:true,trash:true,restore:true,identityAndContentStable:true});
 }
 const team=await workspace.create({kind:'space',name:`TASK011A API Team ${stamp}`,space:'',parent:'',key:randomUUID()},signal);assert.ok(team.id||team.space?.id);
 checks.push('8 creation kinds persisted through real product APIs');checks.push('6 content kinds retain identity and content through rename, move, Trash and Restore');
 fs.writeFileSync(`${output}/oauth-api-crud.json`,JSON.stringify({status:'PASS',carrier:'Node protocol controller + real isolated Workspace Server; not a Desktop UI CRUD claim',checks,matrix},null,2));
 console.log('PASS',checks.length,'groups;',matrix.length,'content kinds');
}finally{await auth.signOut().catch(()=>{});await auth.dispose();await workspace.dispose()}
