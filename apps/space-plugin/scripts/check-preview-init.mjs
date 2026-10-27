// Real SDK negative regression, separate from live product / Desktop acceptance.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { writeEvidence } from './evidence-output.mjs';
const { chromium } = await import(process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright');
const baseline = process.argv.includes('--baseline');
let viewer = baseline
  ? execFileSync('git', ['show', '06f23e90fd66d3d91d44f53f2a4f1c6b7f9afbd5:apps/space-plugin/src/viewer.tsx'], { encoding: 'utf8' })
  : await readFile('src/viewer.tsx', 'utf8');
// Instrument the application under test, not SDK declarations or runtime code.
viewer = viewer.replace("import { Univer }", "import { Univer, ErrorService }")
  .replace('const api = runtime.univerAPI;', `const api = runtime.univerAPI;
    (window as any).previewAPIs ??= [];
    (window as any).previewAPIs.push(api);
    runtime.univer.__getInjector().get(ErrorService).error$.subscribe((error) => {
      (window as any).permissionErrors.push(error.code ?? error.errorKey);
    });`);
const contents = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {getDocsEmptySnapshot, LocaleType, DocumentFlavor} from '@univerjs/core';
import {Viewer} from './src/viewer.tsx';
import './src/collaborative-editor.tsx';
window.permissionErrors=[];
const data=getDocsEmptySnapshot('preview-regression',LocaleType.ZH_CN,'Review',DocumentFlavor.MODERN);
const file={nodeId:'preview-node',unitId:data.id,type:'doc',name:'Review',sha256:'fixture',data};
createRoot(document.getElementById('app')).render(React.createElement('div',{style:{display:'flex',height:'100%'}},React.createElement(Viewer,{file}),React.createElement(Viewer,{file})));`;
const bundle = await build({ stdin: { contents, resolveDir: process.cwd(), loader: 'jsx' },
  bundle: true, platform: 'browser', format: 'esm', write: false, target: 'es2022',
  loader: { '.css': 'text' }, plugins: [{ name: 'observe-preview-errors', setup(build) {
    build.onLoad({ filter: /\/src\/viewer\.tsx$/ }, args => ({ contents: viewer, loader: 'tsx', resolveDir: new URL('../src', import.meta.url).pathname }));
  } }] });
const css = await readFile('lib/univer-scoped.css', 'utf8');
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); }
  else { res.setHeader('content-type', 'text/html'); res.end(`<style>${css}\nhtml,body,#app,.sp-viewer,.sp-sdk{margin:0;width:100%;height:100%;position:relative}</style><div id="app"></div><script type="module" src="/bundle.js"></script>`); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.SPACE_BROWSER_EXECUTABLE });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-viewer-state="ready"]').nth(1).waitFor({ timeout: 30000 });
  const initialized = await page.evaluate(() => ({ errors: [...window.permissionErrors], editable: window.previewAPIs.map(api => api.getActiveDocument().getPermission().canEdit()) }));
  assert.deepEqual(initialized.editable, [false, false]);
  if (baseline) assert.ok(initialized.errors.includes('PERMISSION_DENIED'));
  else assert.deepEqual(initialized.errors, []);
  const realDenial = await page.evaluate(async () => {
    const api = window.previewAPIs[0], document = api.getActiveDocument();
    const before = JSON.stringify(document.getDocumentDataModel().getSnapshot());
    try { await api.executeCommand('doc.command.insert-text', { unitId: document.getId(), body: { dataStream: 'must not write' }, range: { startOffset: 0, endOffset: 0 } }); } catch {}
    return { denied: window.permissionErrors.includes('PERMISSION_DENIED'), unchanged: before === JSON.stringify(document.getDocumentDataModel().getSnapshot()) };
  });
  assert.deepEqual(realDenial, { denied: true, unchanged: true });
  await writeEvidence(`preview-init-${baseline ? 'baseline' : 'final'}.json`, { carrier: 'isolated real SDK regression, not product/Desktop acceptance', initialized, realDenial });
  console.log('PASS preview initialization and real read-only denial', { baseline });
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
