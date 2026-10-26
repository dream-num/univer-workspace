import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectedSnapshot, contextText, userText } from '../lib/model.js';

const document = () => ({ endpoint:'https://workspace.example',nodeId:'private-node-id',resourceId:'private-resource-id',unitId:'private-unit-id',name:'发布计划',type:'doc',revision:3,sha256:'snapshot-digest',capturedAt:'2026-10-26T00:00:00Z',data:{body:{dataStream:'renderer'}},content:{text:'负责人：Lin\r下一步：评审\r\n',sheets:[]} });
test('a selected snapshot stays frozen while the open document changes', () => {
 const open=document(); const selected=selectedSnapshot(open);
 open.content.text='changed after selection';open.data.body.dataStream='changed render data';
 assert.equal(selected.content.text,'负责人：Lin\r下一步：评审\r\n');assert.equal('data' in selected,false);
});
test('native context is readable and does not expose opaque server identities', () => {
 const text=contextText(selectedSnapshot(document()));
 assert.match(text,/《发布计划》/);assert.match(text,/版本：3/);assert.match(text,/负责人：Lin\n下一步：评审/);
 for(const hidden of ['private-node-id','private-resource-id','private-unit-id','workspace.example','renderer']) assert.equal(text.includes(hidden),false);
 assert.match(text,/snapshot-digest/);
});
test('durable native user text is read from text blocks, without treating an assistant response as a receipt', () => {
 assert.equal(userText({content:[{type:'text',text:'selected document'},{type:'image',data:'not text'},{type:'text',text:'user question'}]}),'selected document\nuser question');
 assert.equal(userText({message:{content:[{type:'text',text:'assistant text'}]}}),'');
});
