/** Official native DSH Agent + real Server + two Workspace identities. */
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright');
const out = resolve(process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-coediting'); await mkdir(out, { recursive: true });
const hosts = [await connectHost(), await connectHost(process.env.SPACE_SECOND_DSH_LOG)];
const logins = await Promise.all([process.env.SPACE_TEST_LOGIN_FILE, process.env.SPACE_SECOND_LOGIN_FILE].map(async file => JSON.parse(await readFile(file, 'utf8'))));
for (let i=0;i<2;i++) { await hosts[i].request('space/configure',{endpoint:logins[i].origin}); await hosts[i].request('space/login',{username:logins[i].username,password:logins[i].password}); }
const users = await Promise.all(hosts.map(h=>h.request('space/status'))); assert.notEqual(users[0].user.id,users[1].user.id);
const session='session-f5a52ca5-3458-4d0e-ac46-cc8a5701edc0', root=process.env.SPACE_SESSION_ROOT;
const logFile=(await readdir(root,{recursive:true})).find(x=>x.includes(session)&&x.endsWith('session.v4.jsonl.zstd')); assert.ok(logFile);
const secondRoot=process.env.SPACE_SECOND_SESSION_ROOT; const secondFile=(await readdir(secondRoot,{recursive:true})).find(x=>x.includes(session)&&x.endsWith('session.v4.jsonl.zstd'));
function log(actor=0) { const p=spawnSync('zstd',['-dc',resolve(actor ? secondRoot : root,actor ? secondFile : logFile)],{encoding:'utf8',maxBuffer:128*1024*1024});assert.equal(p.status,0);return p.stdout.trim().split('\n').map(JSON.parse); }
const text=blocks=>blocks?.filter(x=>x.type==='text').map(x=>x.text).join('\n')??'';
const browser=await chromium.launch({headless:true,executablePath:process.env.SPACE_BROWSER_EXECUTABLE});
const pages=[],checks=[],native=[],wire=[],errors=[],consoleErrors=[];
let stage='initialize';
function record(what,data={}) { checks.push({what,...data,at:new Date().toISOString()});console.log('PASS',what); }
async function client(i) {
 const context=await browser.newContext({viewport:{width:1600,height:1000},permissions:['clipboard-read','clipboard-write']});
 await context.addCookies(hosts[i].headers.cookie.split('; ').map(pair=>({name:pair.slice(0,pair.indexOf('=')),value:pair.slice(pair.indexOf('=')+1),url:hosts[i].origin,httpOnly:true})));
 const p=await context.newPage();p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push({user:i,message:e.message}));p.on('console',m=>{if(m.type()==='error')consoleErrors.push({user:i,message:m.text().slice(0,600)});});
 p.on('response',async r=>{try {if(!r.url().includes('/api/space/'))return;const op=new URL(r.url()).pathname.split('/').at(-1);if(!['editing-action','editor-http'].includes(op))return;const req=r.request().postDataJSON().payload,res=(await r.json()).result;wire.push({user:i,op,action:req.action,path:req.path,status:res.value?.status,ok:res.ok,error:res.error?.message,at:new Date().toISOString()});}catch{}});
 p.on('websocket',ws=>{if(new URL(ws.url()).pathname!=='/universer-api/comb/connect')return;const row={user:i,path:'/universer-api/comb/connect',received:0};wire.push(row);ws.on('framereceived',()=>row.received++);});
 await p.goto(hosts[i].origin);await p.getByText('TASK-006 最终正式路径验收',{exact:true}).click();await p.getByRole('navigation',{name:'Activity bar',exact:true}).getByRole('button',{name:'Space',exact:true}).click();pages.push(p);return p;
}
async function ready(p) {await p.locator('[data-editor-state="saved"]').waitFor({timeout:45000});}
async function open(p,node) {if(await p.getByRole('button',{name:'Close viewer',exact:true}).count())await p.getByRole('button',{name:'Close viewer',exact:true}).click();await p.getByRole('navigation',{name:'Content types',exact:true}).getByRole('button',{name:'All',exact:true}).click();await p.locator('.sp-file-open').filter({hasText:node.name}).click();await ready(p);}
async function focusDoc(p) {await p.bringToFront();const boxes=await p.locator('.sp-sdk canvas').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}).filter(r=>r.width>400&&r.height>200));const r=boxes.sort((a,b)=>b.width*b.height-a.width*a.height)[0];assert.ok(r);await p.mouse.dblclick(r.x+300,r.y+100);}
async function copyDoc(p) {await focusDoc(p);await p.keyboard.press('Meta+a');await p.evaluate(()=>navigator.clipboard.writeText('__pending_copy__'));await p.keyboard.press('Meta+c');await p.waitForFunction(async()=>await navigator.clipboard.readText()!=='__pending_copy__');return p.evaluate(()=>navigator.clipboard.readText());}
async function copyRange(p,range) {await p.bringToFront();await p.keyboard.press('Escape');const box=p.locator('.sp-sdk input[class*="univer-appearance-none"]').first();await box.fill(range);await box.press('Enter');await p.evaluate(()=>navigator.clipboard.writeText('__pending_copy__'));await p.keyboard.press('Meta+c');await p.waitForFunction(async()=>await navigator.clipboard.readText()!=='__pending_copy__');return p.evaluate(()=>navigator.clipboard.readText());}
async function waitContent(read,expected) {for(let i=0;i<20;i++){const s=await read();if(s.includes(expected))return s;await new Promise(r=>setTimeout(r,250));}throw new Error('Remote editor did not show '+expected);}
async function requestEdit(p,node,prompt,label,options={}) {
 const actor=options.actor??0; let hookRan=false;
 await p.getByRole('button',{name:'Chat about this document',exact:true}).click();await p.locator(`[data-page-context="${node.id}"][data-context-state="linked"]`).waitFor();
 const before=log(actor).at(-1).seq;await p.locator('.sp-floating-chat [contenteditable="true"]').fill(prompt);await p.locator('.sp-floating-chat').getByRole('button',{name:'发送消息',exact:true}).click();
 let rows=[],calls=[],done;const seen=new Set();
 for(let i=0;i<180;i++){await p.waitForTimeout(1000);rows=log(actor).filter(r=>r.seq>before);calls=rows.filter(r=>r.type==='tool/call');for(const call of calls)if(!seen.has(call.data.callId)){seen.add(call.data.callId);console.log(label,'native tool',call.data.name);}
  if(options.onWrite && !hookRan && calls.some(call=>call.data.name==='univer_edit')) {hookRan=true; await options.onWrite();}
  done=rows.find(r=>r.type==='turn/end');if(done)break;
 }
 const human=rows.find(r=>r.type==='user/message'&&r.data.source?.kind==='user');assert.ok(human);assert.equal(text(human.data.content),prompt);assert.ok(done,'Native Agent turn completed');
 const tools=calls.map(call=>{const result=rows.find(r=>r.type==='tool/result'&&r.data.message.toolCallId===call.data.callId);return {seq:call.seq,name:call.data.name,callId:call.data.callId,arguments:JSON.parse(call.data.arguments),result:result?{seq:result.seq,isError:result.data.message.isError,content:text(result.data.message.content)}:null};});
 native.push({label,actor,sessionId:session,nodeId:node.id,prompt,humanSeq:human.seq,tools,turnEnded:done.seq,answer:rows.filter(r=>r.type==='assistant/message').map(r=>text(r.data.message.content)).join('\n')});
 assert.ok(!tools.some(t=>t.result?.content.includes('not lossless JSON')), 'All native Tool outputs obey the DSH JSON contract');
 if(options.expectWrite!==false) {
 assert.ok(tools.some(t=>t.name==='univer_edit'&&t.result&&!t.result.isError),'Successful native write Tool');
 await p.locator('[data-ai-phase="ready"]').waitFor({timeout:15000});
 } else assert.ok(!tools.some(t=>t.name==='univer_edit'&&t.result&&!t.result.isError&&JSON.parse(t.result.content).committed===true),'No successful unauthorized/canceled write result');
 await writeFile(resolve(out,'coediting-native.json'),JSON.stringify(native,null,2));return tools;
}
async function minimize(p) {const b=p.getByRole('button',{name:'Minimize chat',exact:true});if(await b.count())await b.click();}
async function review(p,label) {await minimize(p);await p.getByRole('button',{name:'Review changes',exact:true}).click();await p.locator('.sp-ai-review [data-viewer-state="ready"]').nth(1).waitFor({timeout:45000});await p.getByRole('button',{name:'Apply changes',exact:true}).waitFor();if(label==='sheet') assert.ok((await p.locator('.sp-ai-cell-changes').innerText()).includes('=B2*2'), 'The captured Review exposes the actual formula, not only its calculated value');await p.screenshot({path:resolve(out,label+'-review.png')});}
try {
 const tag=Date.now().toString(36);const space=(await hosts[0].request('space/create',{kind:'space',name:'TASK-009D '+tag,space:'',parent:'',key:crypto.randomUUID()})).space;
 await hosts[0].request('space/sharing',{action:'set-member',id:space.id,user:users[1].user.id,role:'editor'});
 const files=[];for(const type of ['doc','sheet']) {const created=await hosts[0].request('space/create',{kind:type,name:'TASK-009D '+type+' '+tag,space:space.id,parent:'',key:crypto.randomUUID()});files.push({...created.node,type});}
 await writeFile(process.env.SPACE_COEDIT_FIXTURES ?? '/tmp/task009d-live-fixtures.json',JSON.stringify({space,files,users:users.map(u=>u.user)},null,2));
 const a=await client(0),b=await client(1);record('Two distinct Workspace identities',{users:users.map(u=>({id:u.user.id,username:u.user.username}))});
 for(const node of files) {
  stage=node.type+' open';await open(a,node);await open(b,node);const initial=await hosts[0].request('space/content',{node:node.id});
  const marker=node.type==='doc'?'COEDIT-DOC-'+tag:'COEDIT-SHEET-'+tag;
  const prompt=node.type==='doc'?`请读取当前文档，然后在末尾追加一段“${marker}：这段内容由 Agent 提议，等待用户审阅。”。请通过 Workspace Tools 真正修改隔离草稿并标记 ready，保留原有内容；不要合并主线。`:`请读取当前表格，在工作表的 B2 填入 37，C2 填入公式 =B2*2，D2 填入“${marker}”。请通过 Workspace Tools 真正修改隔离草稿并标记 ready，保留其他内容；不要合并主线。`;
  stage=node.type+' native Agent';const tools=await requestEdit(a,node,prompt,node.type);const pending=await hosts[0].request('space/content',{node:node.id});assert.equal(pending.sha256,initial.sha256);record(node.type+' Agent draft does not modify shared content',{nodeId:node.id,revision:pending.revision});
  stage=node.type+' review';await review(a,node.type);stage=node.type+' apply';await a.getByRole('button',{name:'Apply changes',exact:true}).click();await a.locator('[data-ai-phase="applied"]').waitFor({timeout:45000});await ready(a);
  const local=node.type==='doc'?await waitContent(()=>copyDoc(a),marker):await waitContent(()=>copyRange(a,'B2:D2'),marker);
  assert.ok(local.includes(marker));
  const remote=node.type==='doc'?await waitContent(()=>copyDoc(b),marker):await waitContent(()=>copyRange(b,'B2:D2'),marker);
  if(node.type==='sheet') {assert.ok(remote.includes('37'));assert.ok(remote.includes('74'));}
  await b.screenshot({path:resolve(out,node.type+'-collaborator-applied.png')});await a.screenshot({path:resolve(out,node.type+'-applied.png')});
  const saved=await hosts[1].request('space/content',{node:node.id});assert.ok(saved.revision>initial.revision);assert.ok(JSON.stringify(saved.data).includes(marker));
  if(node.type==='sheet')assert.ok(JSON.stringify(saved.data).includes('=B2*2'));
  record(node.type+' accepted proposal reaches already-open collaborator',{nodeId:node.id,serverRevision:saved.revision,localClipboard:local,remoteClipboard:remote,nativeWriteCalls:tools.filter(t=>t.name==='univer_edit').length});
  stage=node.type+' reopen';await open(a,node);await open(b,node);const reopened=node.type==='doc'?await copyDoc(b):await copyRange(b,'B2:D2');assert.ok(reopened.includes(marker));record(node.type+' close/reopen preserves submitted content',{nodeId:node.id,clipboard:reopened});
 }

 if (!process.env.SPACE_COEDIT_SMOKE_ONLY) {
 const doc=files.find(f=>f.type==='doc'), sheet=files.find(f=>f.type==='sheet');
 async function shared(node) {return hosts[0].request('space/content',{node:node.id});}
 async function appendHuman(p,marker) {await focusDoc(p);await p.keyboard.press('Meta+a');await p.keyboard.press('ArrowRight');await p.keyboard.press('Enter');await p.keyboard.insertText(marker);await ready(p);await waitContent(()=>copyDoc(p),marker);}
 async function writeCell(p,range,value) {await p.bringToFront();const box=p.locator('.sp-sdk input[class*="univer-appearance-none"]').first();await box.fill(range);await box.press('Enter');await p.keyboard.type(value);await p.keyboard.press('Enter');await ready(p);await waitContent(()=>copyRange(p,range),value);}
 // The same Review controls reject actual proposed changes for both Unit types.
 for(const node of files) {
   stage=node.type+' reject';await open(a,node);const before=await shared(node);
   await requestEdit(a,node,node.type==='doc'?`请通过 Workspace Tools 在当前文档末尾追加“REJECT-DOC-${tag}”，生成实际隔离草稿并标记 ready，等待我审阅，不要合并。`:`请通过 Workspace Tools 把当前表格 E2 改为“REJECT-SHEET-${tag}”，生成实际隔离草稿并标记 ready，等待我审阅，不要合并。`,node.type+' reject');
   await review(a,node.type+'-reject');await a.getByRole('button',{name:'Reject changes',exact:true}).click();await a.locator('[data-ai-phase="rejected"]').waitFor();assert.equal((await shared(node)).sha256,before.sha256);await a.screenshot({path:resolve(out,node.type+'-rejected.png')});record(node.type+' Reject leaves shared revision/hash unchanged',{nodeId:node.id,revision:before.revision});
 }
 // Human edits during Agent execution and again after review invalidate the old acceptance.
 stage='doc concurrent edits';await open(a,doc);await open(b,doc);
 const aiMarker='CONFLICT-AI-'+tag, during='HUMAN-DURING-'+tag, after='HUMAN-AFTER-REVIEW-'+tag;
 await requestEdit(a,doc,`请读取当前文档，用 Workspace Tools 追加“${aiMarker}”并标记 ready。本次用于验证并发编辑，请在实际 univer_edit 的 Facade 程序中先等待 8 秒，再追加段落；不要合并。`, 'doc concurrent', {onWrite:async()=>{await appendHuman(b,during);record('Human edits trunk while the native Agent write is running',{nodeId:doc.id});}});
 const humanOnly=await shared(doc);assert.ok(humanOnly.content.text.includes(during));assert.ok(!humanOnly.content.text.includes(aiMarker));await review(a,'doc-concurrent');await appendHuman(b,after);const beforeApply=await shared(doc);
 await a.getByRole('button',{name:'Apply changes',exact:true}).click();await a.locator('[data-ai-phase="conflict"]').waitFor();assert.equal((await shared(doc)).sha256,beforeApply.sha256);await a.screenshot({path:resolve(out,'doc-conflict.png')});record('Doc old review is refused after a human shared edit',{nodeId:doc.id,revision:beforeApply.revision});
 await review(a,'doc-conflict-refreshed');await a.getByRole('button',{name:'Reject changes',exact:true}).click();await a.locator('[data-ai-phase="rejected"]').waitFor();assert.equal((await shared(doc)).sha256,beforeApply.sha256);
 stage='sheet conflict';await open(a,sheet);await open(b,sheet);
 await requestEdit(a,sheet,`请用 Workspace Tools 把当前表格 E4 改为“CONFLICT-SHEET-${tag}”，生成实际草稿并标记 ready，等待用户审阅，不要合并。`,'sheet conflict');await review(a,'sheet-before-conflict');await writeCell(b,'F4','HUMAN-SHEET-'+tag);const sheetBefore=await shared(sheet);
 await a.getByRole('button',{name:'Apply changes',exact:true}).click();await a.locator('[data-ai-phase="conflict"]').waitFor();assert.equal((await shared(sheet)).sha256,sheetBefore.sha256);await a.screenshot({path:resolve(out,'sheet-conflict.png')});record('Sheet old review is refused and preserves the human cell',{nodeId:sheet.id,revision:sheetBefore.revision});await a.getByRole('button',{name:'Reject',exact:true}).click();await a.locator('[data-ai-phase="rejected"]').waitFor();
 // Real in-flight cancellation plus rapid Page switches; request target stays fixed.
 stage='cancel and switch';await open(a,doc);const docBeforeCancel=await shared(doc),sheetBeforeCancel=await shared(sheet);
 const canceledTools=await requestEdit(a,doc,`请用 Workspace Tools 修改当前文档：在 univer_edit 的实际 Facade 程序中先 await 一个 15 秒计时器，然后追加“CANCEL-ME-${tag}”，再标记 ready。此请求用于测试执行中的取消，不要合并。`,'cancel and switch',{expectWrite:false,onWrite:async()=>{
   await open(a,sheet);await open(a,doc);await open(a,sheet);await open(a,doc);
   await a.getByRole('button',{name:'Cancel AI changes',exact:true}).click();await a.locator('[data-ai-phase="canceled"]').waitFor({timeout:45000});
   const stop=a.locator('.sp-floating-chat').getByRole('button',{name:'停止生成',exact:true});if(await stop.count())await stop.click();
 }});
 assert.equal((await shared(doc)).sha256,docBeforeCancel.sha256);assert.equal((await shared(sheet)).sha256,sheetBeforeCancel.sha256);await a.screenshot({path:resolve(out,'canceled-after-page-switches.png')});record('Cancel in-flight native write and rapid Page switches preserve both shared documents',{nodeId:doc.id,otherNodeId:sheet.id,calls:canceledTools.map(t=>t.name)});
 // Distinct actual Workspace identity: Viewer denial, Editor draft, then revocation.
 stage='Viewer denial';await hosts[0].request('space/sharing',{action:'set-member',id:space.id,user:users[1].user.id,role:'viewer'});await open(b,doc);const beforeDenied=await shared(doc);
 const denied=await requestEdit(b,doc,`请实际调用 Workspace 写入工具尝试在当前文档追加“VIEWER-DENIED-${tag}”，由服务端核对权限；如被拒绝，报告真实失败，不要通过其他方式写入。`,'Viewer denied',{actor:1,expectWrite:false});assert.ok(denied.some(t=>t.result?.isError),'Native permission-denied Tool result');assert.equal((await shared(doc)).sha256,beforeDenied.sha256);await b.screenshot({path:resolve(out,'viewer-permission-denied.png')});record('Viewer native Workspace write is denied',{userId:users[1].user.id,nodeId:doc.id});
 stage='Editor and removal';await hosts[0].request('space/sharing',{action:'set-member',id:space.id,user:users[1].user.id,role:'editor'});await open(b,doc);await requestEdit(b,doc,`请用 Workspace Tools 在当前文档末尾追加“EDITOR-DRAFT-${tag}”，保存隔离草稿并标记 ready，等待我审阅，不要合并。`,'Editor draft',{actor:1});await review(b,'editor-before-revocation');const beforeRevoked=await shared(doc);
 await hosts[0].request('space/sharing',{action:'remove-member',id:space.id,user:users[1].user.id});await b.getByRole('button',{name:'Apply changes',exact:true}).click();await b.locator('.sp-ai-changes [role="alert"]').waitFor({timeout:30000});assert.equal((await shared(doc)).sha256,beforeRevoked.sha256);await b.screenshot({path:resolve(out,'removed-member-apply-denied.png')});record('Removed Editor cannot apply an already-reviewed draft in the existing Session',{userId:users[1].user.id,nodeId:doc.id,revision:beforeRevoked.revision});
 await b.getByRole('button',{name:'Chat about this document',exact:true}).click();
 await b.locator('[data-context-state="failed"]').waitFor();
 const blockedComposer=b.locator('.sp-floating-chat [data-composer-input]');
 assert.equal(await blockedComposer.getAttribute('contenteditable'),'false');
 assert.equal(await blockedComposer.getAttribute('aria-disabled'),'true');
 assert.equal(await b.locator('.sp-floating-chat').getAttribute('data-session-id'),session);
 assert.equal((await shared(doc)).sha256,beforeRevoked.sha256);
 await b.screenshot({path:resolve(out,'removed-member-session-blocked.png')});
 record('The same native Session blocks further document requests after membership removal',{userId:users[1].user.id,sessionId:session,association:'failed',composerEditable:false});

 }
 assert.deepEqual(errors,[]);stage='complete';
} catch(error) {for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:resolve(out,`coediting-failure-${i}.png`)}).catch(()=>{});throw error;}
finally {await writeFile(resolve(out,'coediting-live.json'),JSON.stringify({carrier:'Official DSH Web / Edge, two independent official Hosts',stage,checks,native,wire,pageErrors:errors,consoleErrors},null,2));await browser.close();}
