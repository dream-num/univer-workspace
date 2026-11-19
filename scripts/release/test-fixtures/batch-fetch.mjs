import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const base=process.env.FIXTURE_DIRECTORY;
const entries=JSON.parse(await readFile(join(base,'entries.json'),'utf8'));
const origin='https://insider-npm-registry.univer.work';
const json=value=>Response.json(value);
// Reject all unrecognized traffic instead of delegating to the real fetch.
globalThis.fetch=async (input,request)=>{
 const url=new URL(input);
 if(url.origin!==origin)throw Error('Unexpected non-fixture registry request');
 if(url.pathname==='/-/insider/v1/promotions' && url.searchParams.get('dryRun')==='true' && request.method==='POST'){
  const {packages}=JSON.parse(request.body);
  if(packages.length!==2 || packages.some(x=>!entries.some(y=>x.name===y.name&&x.version===y.version))) throw Error('Unexpected fixture batch');
  return json({status:'completed',dryRun:true,publicRegistryWriteVerified:false,packageCount:2,packages:entries.toReversed().map(({name,version})=>({name,version,publicVersion:'publish'}))});
 }
 for (const [i,p] of entries.entries()){
  const source=await readFile(join(base,'pkg'+i+'.tgz'));
  const current = process.env.FIXTURE_MUTATE_TARBALL === 'true' && i === 1 ? await readFile(join(base,'pkg1-changed.tgz')) : source;
  if(decodeURIComponent(url.pathname)==='/'+p.name) return json({name:p.name,versions:{[p.version]:{name:p.name,version:p.version,
    dist:{integrity:'sha512-'+createHash('sha512').update(current).digest('base64'),tarball:origin+'/tar'+i}}},'dist-tags':{[p.tag]:p.version}});
  if(url.pathname==='/tar'+i) return new Response(current);
 }
 throw Error('Unexpected fixture path');
};
