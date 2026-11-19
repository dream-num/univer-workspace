import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const base=process.env.FIXTURE_DIRECTORY;
const packages=[];
for (const [i,name] of ['@synthetic/cli-sdk','@synthetic/collab-sdk'].entries()){
 const version='1.0.0-rc.1',tag='rc',dir=join(base,'src'+i);
 await mkdir(join(dir,'package'),{recursive:true});
 await writeFile(join(dir,'package','package.json'),JSON.stringify({name,version}));
 const file=join(base,'pkg'+i+'.tgz');
 execFileSync('tar',['-czf',file,'-C',dir,'package']);
 const integrity='sha512-'+createHash('sha512').update(await readFile(file)).digest('base64');
 packages.push({name,version,tag,integrity});
 if(i===1){
   await writeFile(join(dir,'package','changed.txt'),'Insider slot now points to different bytes');
   execFileSync('tar',['-czf',join(base,'pkg1-changed.tgz'),'-C',dir,'package']);
 }
}
await writeFile(join(base,'entries.json'),JSON.stringify(packages));
const selection={batchId:'cross-repo-sdk-ci',packages:packages.map(({name,version,tag})=>({name,version,tag}))};
await writeFile(process.env.GITHUB_OUTPUT,'selection='+JSON.stringify(selection)+'\n');
