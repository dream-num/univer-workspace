import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ToolBindings } from '../lib/tools.js';
function setup() {
 let user='user1',resource='r1',readCount=0;
 const workspace={ endpoint:'http://localhost',status:async()=>({state:'connected',endpoint:'http://localhost',user:{id:user}}),json:async()=>({node:{id:'n1',name:'Document',resource:{id:resource,unitId:'u1',unitType:'doc',capabilities:{openContent:true}}}}),read:async()=>{readCount++;return {endpoint:'http://localhost',resourceId:resource,unitId:'u1',type:'doc',revision:2,sha256:'digest',capturedAt:'now',content:{text:'one\rtwo\rthree',sheets:[]}}}};
 return { bindings:new ToolBindings(workspace), user(value){user=value},resource(value){resource=value}, reads:()=>readCount };
}
test('read grant is bound to Session and current identity; association does not fetch body', async()=>{
 const f=setup();await f.bindings.bind('s1','n1');assert.equal(f.reads(),0);
 await assert.rejects(f.bindings.inspect('s2','n1',new AbortController().signal),/Associate/);
 await assert.rejects(f.bindings.inspect('s1','other',new AbortController().signal),/not associated/);
 const read=await f.bindings.inspect('s1','n1',new AbortController().signal,0,2);assert.deepEqual(read.lines,[{index:0,text:'one'},{index:1,text:'two'}]);assert.equal(read.nextOffset,2);
 f.user('user2');await assert.rejects(f.bindings.inspect('s1','n1',new AbortController().signal),/Associate/);assert.equal(f.reads(),1);
});
test('changed resource identity, cancellation and logout clear cannot use an old grant',async()=>{
 const f=setup();await f.bindings.bind('s1','n1');f.resource('other');await assert.rejects(f.bindings.inspect('s1','n1',new AbortController().signal),/identity changed/);
 const abort=new AbortController();abort.abort();await assert.rejects(f.bindings.inspect('s1','n1',abort.signal));f.bindings.clear();await assert.rejects(f.bindings.scope('s1'),/Associate/);
});
