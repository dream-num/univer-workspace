/** Cross-check native Tool records against authoritative persisted Worktree state. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WorkspaceConnection } from '../lib/workspace.js';
const out=resolve(process.env.SPACE_EVIDENCE_DIR??'/tmp/space-coediting');
const native=JSON.parse(await readFile(resolve(out,'coediting-native.json'),'utf8'));
const logins=await Promise.all([process.env.SPACE_TEST_LOGIN_FILE,process.env.SPACE_SECOND_LOGIN_FILE].map(async path=>JSON.parse(await readFile(path,'utf8'))));
const workspaces=logins.map(()=>new WorkspaceConnection()),states=[];
try {
 for(let i=0;i<2;i++){workspaces[i].configure(logins[i].origin);await workspaces[i].login(logins[i].username,logins[i].password);}
 for(const record of native) {
  const create=record.tools.find(tool=>tool.name==='univer_worktree'&&tool.arguments.action==='create'&&tool.result&&!tool.result.isError);
  if(!create) {assert.equal(record.label,'Viewer denied');states.push({label:record.label,actor:record.actor,deniedBeforeDraftCreation:true});continue;}
  const result=JSON.parse(create.result.content),worktreeId=result.worktreeId;
  const {worktree}=await workspaces[record.actor].json(`/api/worktrees/${encodeURIComponent(worktreeId)}`);
  const expected=['doc','sheet'].includes(record.label)?'merged':record.label==='Editor draft'?'ready':'discarded';
  assert.equal(worktree.state,expected);
  if(record.label==='Editor draft')assert.equal(worktree.capabilities.merge,false);
  states.push({label:record.label,actor:record.actor,sessionId:record.sessionId,nodeId:record.nodeId,worktreeId,expected,observed:worktree});
 }
 await writeFile(resolve(out,'worktree-persistence-states.json'),JSON.stringify({at:new Date().toISOString(),states},null,2));
 console.log('Verified authoritative Worktree states',states.length);
} finally {await Promise.all(workspaces.map(w=>w.dispose()));}
