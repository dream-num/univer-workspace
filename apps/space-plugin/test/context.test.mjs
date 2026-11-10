import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectedReference, referenceText, userText, submittedReference } from '../lib/model.js';
const document = () => ({ endpoint:'https://workspace.example',nodeId:'n1',resourceId:'r1',unitId:'u1',name:'发布计划',type:'doc',revision:3,sha256:'digest',data:{body:{dataStream:'PRIVATE-BODY'}},content:{text:'PRIVATE-BODY',sheets:[]} });
test('native file reference has stable identities and never contains content/snapshot', () => {
 const open=document(); const ref=selectedReference(open);open.name='other';
 assert.equal(ref.name,'发布计划'); assert.equal('content' in ref,false); assert.equal('data' in ref,false);
 const text=referenceText(ref);assert.match(text,/workspace-file:\/\/r1\?nodeId=n1&unitId=u1/);assert.equal(text.includes('PRIVATE-BODY'),false);
});
test('submission receipt reads durable user blocks only', () => {
 assert.equal(userText({content:[{type:'text',text:'reference'},{type:'image',data:'hidden'}]}),'reference');
 assert.equal(userText({message:{content:[{type:'text',text:'assistant'}]}}),'');
});

test('native receipt requires a newer human event; older history and assistant text cannot submit a draft',()=>{
 const file=selectedReference(document());const data={source:{kind:'user'},content:[{type:'text',text:referenceText(file)}]};
 const row=(seq,type='user/message')=>({type:'event',event:{seq,type,data}});
 assert.equal(submittedReference([row(10),row(21,'assistant/message')],file,20),false);
 assert.equal(submittedReference([row(10),row(21)],file,20),true);
 assert.equal(submittedReference([{type:'transient',event:{seq:22,type:'user/message',data}}],file,20),false);
});


test('every supported file keeps a body-free current identity, including a Site without a Unit', () => {
  for (const type of ['doc', 'sheet', 'slide', 'board', 'base', 'site']) {
    const ref = selectedReference({
      ...document(),
      type,
      unitId: type === 'site' ? '' : 'unit',
    });
    assert.equal(ref.type, type);
    assert.equal('data' in ref, false);
    assert.equal('content' in ref, false);
  }
});
