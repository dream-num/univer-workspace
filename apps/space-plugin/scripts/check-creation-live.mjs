import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {connectHost} from './host-connection.mjs';
const {chromium}=await import(process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright');
const h=await connectHost(), f=JSON.parse(await readFile(process.env.SPACE_TEST_LOGIN_FILE,'utf8'));
const out=resolve(process.env.SPACE_EVIDENCE_DIR ?? '/tmp/task009b-evidence');await mkdir(out,{recursive:true});
await h.request('space/configure',{endpoint:f.origin});await h.request('space/login',{username:f.username,password:f.password});
const b=await chromium.launch({headless:true,executablePath:process.env.SPACE_BROWSER_EXECUTABLE});
const c=await b.newContext({viewport:{width:1440,height:1000}});
await c.addCookies(h.headers.cookie.split('; ').map(p=>({name:p.slice(0,p.indexOf('=')),value:p.slice(p.indexOf('=')+1),url:h.origin,httpOnly:true})));
const p=await c.newPage(), errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(25000);
const stamp=Date.now(), records={};
try {
 await p.goto(h.origin);await p.getByRole('navigation',{name:'Activity bar',exact:true}).getByRole('button',{name:'Space',exact:true}).click();
 const create=async(kind,name)=>{
  await p.locator('.sp-primary summary').click();await p.getByRole('menuitem',{name:kind,exact:true}).click();
  const d=p.getByRole('dialog',{name:`Create ${kind.toLowerCase()}`,exact:true});
  await d.getByLabel('Name',{exact:true}).fill(name);await d.getByRole('button',{name:'Create',exact:true}).click();await d.waitFor({state:'hidden'});
 };
 await create('Space',`TASK009B-${stamp}`);
 const spaces=await h.request('space/spaces');records.space=spaces.spaces.find(s=>s.name===`TASK009B-${stamp}`);assert.ok(records.space.capabilities.createAtRoot);
 await create('Folder',`Acceptance folder ${stamp}`);
 const root=await h.request('space/nodes',{space:records.space.id});records.folder=root.nodes.find(n=>n.name===`Acceptance folder ${stamp}`);assert.ok(records.folder.capabilities.createChildren);
 await p.locator('.sp-file-open').filter({hasText:records.folder.name}).click();
 for(const kind of ['Doc','Sheet']) {
  const name=`${kind} collaboration ${stamp}`;await create(kind,name);
  await p.locator('[data-viewer-state="ready"]').waitFor();
  const nodes=await h.request('space/nodes',{parent:records.folder.id});const node=nodes.nodes.find(n=>n.name===name);assert.ok(node);assert.equal(node.parentNodeId,records.folder.id);assert.equal(node.resource.unitType,kind.toLowerCase());assert.equal(node.accessRole,'owner');records[kind.toLowerCase()]=node;
  await p.screenshot({path:resolve(out,`created-${kind.toLowerCase()}.png`)});
  await p.getByRole('button',{name:'Close viewer',exact:true}).click();await p.locator('.sp-file-open').filter({hasText:name}).waitFor();
 }
 assert.deepEqual(errors,[]);await writeFile(resolve(out,'creation-live.json'),JSON.stringify({carrier:'Official DSH Web / Edge',records,errors,checks:['Space real API + automatic navigation','Folder appears at Space root','Doc + Sheet in Folder','created content auto-opens','owner + Resource/Unit identity','list refresh without reload']},null,2));
 await writeFile('/tmp/task009b-fixtures.json',JSON.stringify(records));console.log(JSON.stringify({checks:6,ids:Object.fromEntries(Object.entries(records).map(([k,v])=>[k,v.id]))}));
} catch(e){await p.screenshot({path:resolve(out,'creation-failure.png')});console.log((await p.locator('body').innerText()).slice(-5000));throw e;}finally{await b.close();}
