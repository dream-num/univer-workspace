import { connectHost } from './host-connection.mjs';
import { writeEvidence } from './evidence-output.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const tarball=process.env.SPACE_PLUGIN_TARBALL;
if (!tarball?.startsWith('/')) throw new Error('SPACE_PLUGIN_TARBALL must be the exact built local tarball. This test disables, removes and reinstalls it in the current test Desktop profile.');
const host=await connectHost();
const steps=[];
const fileHash=async()=>process.env.SPACE_SESSION_LOG ? createHash('sha256').update(await readFile(process.env.SPACE_SESSION_LOG)).digest('hex') : null;
const beforeSession=await fileHash();
const inventory=async()=> (await host.request('pluginManager/listBundles',{args:{}})).filter(row=>row.name==='dsh-space-plugin').map(({name,version,enabled,installed})=>({name,version,enabled,installed}));
const probe=async()=>{const r=await fetch(`${host.origin}/api/space/status`,{method:'POST',headers:host.headers,body:host.body('space/status',{})});return r.status;};
for (const [name,args,expected] of [
 ['setBundleEnabled',{name:'dsh-space-plugin',enabled:false},404],
 ['setBundleEnabled',{name:'dsh-space-plugin',enabled:true},200],
 ['removeBundle',{name:'dsh-space-plugin'},404],
 ['installBundle',{spec:tarball,options:{enabled:true}},200],
]) {
 const result=await host.request(`pluginManager/${name}`,{args});
 const status=await probe();
 steps.push({operation:name,...(args.enabled===undefined?{}:{enabled:args.enabled}),application:result.application,stage:result.stage,error:result.error??null,routeStatus:status,expectedRouteStatus:expected,inventory:await inventory()});
}
const afterSession=await fileHash();
const report={at:new Date().toISOString(),carrier:'official Electron-owned Host manager RPC; not Desktop window UI',origin:host.origin,steps,nativeSessionLogPreserved:beforeSession===null?null:beforeSession===afterSession,beforeSessionLogSha256:beforeSession,afterSessionLogSha256:afterSession};
await writeEvidence('desktop-host-lifecycle.json',report);
const passed=steps.every(step=>step.application==='applied'&&step.routeStatus===step.expectedRouteStatus);
console.log(JSON.stringify({passed,steps:steps.map(({operation,enabled,application,routeStatus})=>({operation,enabled,application,routeStatus})),nativeSessionLogPreserved:report.nativeSessionLogPreserved}));
if(!passed) process.exitCode=2;
