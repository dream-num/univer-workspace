import { randomUUID, randomBytes } from 'node:crypto';
import { writeFile, chmod } from 'node:fs/promises';
const origin = process.env.SPACE_TEST_ENDPOINT ?? 'http://127.0.0.1:3020';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Seed only against an explicit local test Server.');
const loginFile = process.env.SPACE_TEST_LOGIN_FILE ?? '/tmp/task004-workspace-login.json';
const password = randomBytes(18).toString('base64url');
const username = `task004-${Date.now()}`;
let cookie = '';
async function request(path, value, extra = {}) {
 const response = await fetch(origin + path, { headers: { 'content-type':'application/json', cookie, ...extra }, ...(value ? { method: 'POST', body: JSON.stringify(value) } : {}) });
 if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 const body=await response.json(); if(!response.ok) throw new Error(JSON.stringify(body)); return body;
}
await request('/api/auth/password/register',{username,password,displayName:'TASK-004 Review'});
const {spaces} = await request('/api/spaces'); const space=spaces.find(s=>s.type==='personal');
const folder=await request('/api/nodes',{spaceId:space.id,parentNodeId:null,name:'TASK-004 Evidence'});
const doc=await request('/api/resources',{kind:'univer',spaceId:space.id,parentNodeId:folder.id,name:'Runtime acceptance document',unitType:'doc',initialData:{id:'placeholder',title:'Runtime acceptance document',body:{dataStream:'TASK-004 runtime evidence\r\nVerification code: SPACE-ORBIT-7419\r\nThe launch owner is Lin. The approved budget is 4270 CNY.\r\nThis is a real Workspace Document persisted by the local Server.\r\n',paragraphs:[{startIndex:25}]},documentStyle:{pageSize:{width:595,height:842}}}}, {'Idempotency-Key':randomUUID()});
const sheet=await request('/api/resources',{kind:'univer',spaceId:space.id,parentNodeId:folder.id,name:'Runtime acceptance sheet',unitType:'sheet',initialData:{id:'placeholder',name:'Runtime acceptance sheet',sheetOrder:['sheet1'],sheets:{sheet1:{id:'sheet1',name:'Acceptance budget',rowCount:100,columnCount:26,cellData:{0:{0:{v:'Item'},1:{v:'Amount CNY'}},1:{0:{v:'Prototype'},1:{v:3200}},2:{0:{v:'Review'},1:{v:1070}},3:{0:{v:'Approved total'},1:{v:4270}}}}}}}, {'Idempotency-Key':randomUUID()});
const record={origin,username,password,cookie,spaceId:space.id,folderId:folder.id,doc:doc.node,sheet:sheet.node};
await writeFile(loginFile,JSON.stringify(record),{mode:0o600}); await chmod(loginFile,0o600);
console.log(JSON.stringify({origin,spaceId:space.id,folderId:folder.id,doc:doc.node,sheet:sheet.node},null,2));
