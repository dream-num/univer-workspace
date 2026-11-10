import { randomUUID, randomBytes } from 'node:crypto';
import { writeFile, chmod } from 'node:fs/promises';
const origin = process.env.SPACE_TEST_ENDPOINT ?? 'http://127.0.0.1:3020';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Seed only against an explicit local test Server.');
const loginFile = process.env.SPACE_TEST_LOGIN_FILE ?? '/tmp/task005-workspace-login.json';
const password = randomBytes(18).toString('base64url');
const username = `task005-${Date.now()}`;
let cookie = '';
async function request(path, value, extra = {}) {
 const response = await fetch(origin + path, { headers: { 'content-type':'application/json', cookie, ...extra }, ...(value ? { method: 'POST', body: JSON.stringify(value) } : {}) });
 if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 const body=await response.json(); if(!response.ok) throw new Error(JSON.stringify(body)); return body;
}
await request('/api/auth/password/register',{username,password,displayName:'Space Demo'});
const {spaces} = await request('/api/spaces'); const space=spaces.find(s=>s.type==='personal');
const folder=await request('/api/nodes',{spaceId:space.id,parentNodeId:null,name:'产品发布'});
const paragraphs = [
 'Space 发布计划',
 '把文档、表格与已有的 Agent 对话连接起来。',
 '本周目标',
 '完成内容首页与只读文档工作区，让团队从真实内容开始工作。',
 '负责人：Lin · 计划预算：4,270 CNY',
 '发布检查',
 '浏览 Workspace 中的真实文件；保留 Folder 位置与文件切换路径。',
 '明确选择文档上下文，再加入已有 DSH 对话的原生草稿。',
 '使用原生输入框发送，并检查 Agent 的实际答复。',
 '下一步',
 '在官方 Desktop 完成 UX 验收后，再评审编辑与 Agent 写入。',
 '验收标记：SPACE-ORBIT-7419',
];
const dataStream = paragraphs.join('\r')+'\r\n';
let index = 0;
const paragraphData = paragraphs.map((text, i) => { index += text.length; const p = {startIndex:index,paragraphStyle:{lineSpacing:1.5,spaceAbove:{v:i===0 ? 0 : 8},spaceBelow:{v:6}}};index++; return p; });
const textRuns = [];
let position=0;
paragraphs.forEach((text,i)=>{ if ([0,2,5,9].includes(i)) textRuns.push({st:position,ed:position+text.length,ts:{fs:i===0?25:16,bl:1}}); position+=text.length+1; });
const doc=await request('/api/resources',{kind:'univer',spaceId:space.id,parentNodeId:folder.id,name:'Space 发布计划',unitType:'doc',initialData:{id:'placeholder',title:'Space 发布计划',body:{dataStream,paragraphs:paragraphData,textRuns,sectionBreaks:[{startIndex:dataStream.length-1}]},documentStyle:{documentFlavor:1,pageSize:{width:680,height:960},marginTop:55,marginBottom:55,marginRight:55,marginLeft:55}}}, {'Idempotency-Key':randomUUID()});
const sheet=await request('/api/resources',{kind:'univer',spaceId:space.id,parentNodeId:folder.id,name:'发布预算',unitType:'sheet',initialData:{id:'placeholder',name:'发布预算',sheetOrder:['budget'],styles:{header:{bg:{rgb:'#3f6657'},cl:{rgb:'#ffffff'},bl:1,fs:11},total:{bg:{rgb:'#eaf1ec'},bl:1}},sheets:{budget:{id:'budget',name:'预算明细',rowCount:100,columnCount:26,defaultColumnWidth:120,defaultRowHeight:28,columnData:{0:{w:180},1:{w:120},2:{w:170}},rowData:{0:{h:36}},cellData:{0:{0:{v:'项目',s:'header'},1:{v:'金额（CNY）',s:'header'},2:{v:'负责人',s:'header'}},1:{0:{v:'体验原型'},1:{v:3200},2:{v:'Lin'}},2:{0:{v:'设计评审'},1:{v:1070},2:{v:'团队'}},3:{0:{v:'已批准合计',s:'total'},1:{v:4270,s:'total'},2:{v:'本周发布',s:'total'}}}}}}}, {'Idempotency-Key':randomUUID()});
const record={origin,username,password,cookie,spaceId:space.id,folderId:folder.id,doc:doc.node,sheet:sheet.node};
await writeFile(loginFile,JSON.stringify(record),{mode:0o600}); await chmod(loginFile,0o600);
console.log(JSON.stringify({origin,spaceId:space.id,folderId:folder.id,doc:doc.node,sheet:sheet.node},null,2));
