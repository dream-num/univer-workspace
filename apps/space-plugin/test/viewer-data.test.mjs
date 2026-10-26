import assert from 'node:assert/strict';
import {test} from 'node:test';
import {viewerData} from '../lib/viewer-data.js';
test('modern view leaves Server body, assets, section breaks and input snapshot intact',()=>{
 const file={type:'doc',name:'Server title',data:{title:'old',documentStyle:{documentFlavor:1,pageSize:{width:680,height:960}},body:{dataStream:'Body\r\n',sectionBreaks:[{startIndex:5}],textRuns:[{st:0,ed:4,ts:{bl:1}}]},drawings:{a:{source:'asset'}}}};
 const before=structuredClone(file);const view=viewerData(file);
 assert.equal(view.documentStyle.documentFlavor,2);assert.equal(view.title,'Server title');assert.deepEqual(view.body,file.data.body);assert.deepEqual(view.drawings,file.data.drawings);assert.deepEqual(file,before);
 view.body.dataStream='local';assert.equal(file.data.body.dataStream,'Body\r\n');
});
test('Sheet view keeps exact cell data and never adds Doc layout',()=>{
 const file={type:'sheet',name:'Budget',data:{sheets:{s:{cellData:{3:{1:{v:4270,f:'=SUM(B1:B3)'}}}}}}};
 const view=viewerData(file);assert.equal(view.documentStyle,undefined);assert.deepEqual(view.sheets,file.data.sheets);
});
