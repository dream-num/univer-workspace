#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = `Usage: node .claude/skills/verify-uvw/bin/html-view-style-thumbnails.mjs [--self-test | --help]
Run from the repository root after verify-uvw up, user, and eval "$($V env)".
Uses source-built uvw, agent-browser, and cwebp (quality 80, 640x400).
Creates four disposable source Sheets and publishes each discovered template.
Screenshots, bound HTML, readbacks and a manifest remain in $EVIDENCE/style-thumbnails.
Run verify-uvw down afterwards. Never use a production instance.`;
if (process.argv.includes('--help')) { console.log(usage); process.exit(0); }
assert(process.argv.length === 2 || process.argv.slice(2).join() === '--self-test', usage);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const helper = join(root, '.claude/skills/verify-uvw/bin/verify-uvw');
const templates = join(root, 'apps/cli/skill-data/html-view/templates');
const output = join(root, 'apps/workspace/web/src/features/html-views/style-thumbnails');
const normalize = text => text.replace(/revenueGrowth/g, 'revenue growth').replace(/\s+/g, ' ').trim();
const layouts = {
  runway: {
    expected: `A1:B1 = Cash flow assumptions, Value. A2:B6 = Opening cash, Monthly revenue,
Monthly revenue growth (fraction), Fixed monthly costs, Added monthly payroll; labels A, numbers B.
A7 = Start month; B7 = YYYY-MM text (e.g. 2026-12) or a spreadsheet date (1899-12-30 epoch).
A8:E8 = Month, Opening cash, Revenue, Costs, Closing cash.
A9:E44 = 36 monthly formula rows; A = month index 1..36, B:E numeric formula results.
At least 44 rows and 5 columns. Chart/answer read all 36 months; table shows first 12.`,
    bounds: [44, 5],
    rows: () => [
      ['Cash flow assumptions', 'Value', '', '', ''],
      ['Opening cash', 3200000, '', '', ''],
      ['Monthly revenue', 180000, '', '', ''],
      ['Monthly revenue growth (fraction)', 0.035, '', '', ''],
      ['Fixed monthly costs', 360000, '', '', ''],
      ['Added monthly payroll', 15000, '', '', ''],
      ['Start month', '2026-12', '', '', ''],
      ['Month', 'Opening cash', 'Revenue', 'Costs', 'Closing cash'],
      ...Array.from({ length: 36 }, (_, i) => {
        const row = i + 9;
        return [`=ROW()-8`, i === 0 ? '=$B$2' : `=E${row - 1}`, `=$B$3*(1+$B$4)^(A${row}-1)`, `=$B$5+$B$6*(A${row}-1)`, `=B${row}+C${row}-D${row}`];
      }),
    ],
    ready: `document.querySelectorAll('#rows .tr').length === 12 && document.querySelector('#base')?.children.length === 5 && document.querySelectorAll('#svg path,#svg rect').length > 5`,
  },
  sales: {
    expected: `row 1 headers A Month, B Region, C Channel, D Actual sales, E Sales target.
Rows 2:201 contain up to 200 records; at least 201 rows and 5 columns. Amounts are numeric; target is nonnegative. Region values East/South/North; channels Direct/Partner/Online.`,
    bounds: [201, 5],
    rows: () => [['Month', 'Region', 'Channel', 'Actual sales', 'Sales target'],
      ...['2026-07', '2026-08', '2026-09'].flatMap((month, m) =>
        ['East', 'South', 'North'].flatMap((region, r) => ['Direct', 'Partner', 'Online'].map((channel, c) => {
          const target = 900000 + r * 150000 + c * 100000 + m * 80000;
          return [month, region, channel, Math.round(target * (0.78 + ((m * 5 + r * 3 + c) % 8) * 0.07)), target];
        })))],
    ready: `document.querySelector('#status')?.textContent === 'Live data connected' && document.querySelector('#chart svg path') && document.querySelectorAll('#record option').length === 27`,
  },
  delivery: {
    expected: `row 1 headers A Task ID, B Task, C Customer, D Owner, E Status (Not started/In progress/Done/Blocked), F Due date (ISO date text or Sheet date serial).
Bounds: A2:F201, at most 200 tasks; worksheet must have at least 201 rows and 6 columns. New records insert below row 1, shifting older records down. Task IDs must be unique.`,
    bounds: [201, 6],
    rows: () => [['Task ID', 'Task', 'Customer', 'Owner', 'Status', 'Due date'],
      ...['Acme', 'Northstar', 'Evergreen'].flatMap((customer, c) =>
        ['Kickoff', 'Data migration', 'Integration test', 'Team training'].map((task, i) => {
          const due = new Date();
          due.setDate(due.getDate() + [-2, 0, 3, 6][i]);
          const date = [due.getFullYear(), String(due.getMonth() + 1).padStart(2, '0'), String(due.getDate()).padStart(2, '0')].join('-');
          return [`IMP-${101 + c * 4 + i}`, task, customer, ['Maya', 'Alex', 'Sam'][c], ['Done', 'Blocked', 'In progress', 'Not started'][i], date];
        }))],
    ready: `document.querySelectorAll('[data-id]').length >= 12 && document.body.innerText.includes('Acme') && document.body.innerText.includes('Integration test')`,
  },
  cities: {
    expected: `Row 1 headers A Entry ID, B City, C Joined at (ISO timestamp). Rows 2:101 sign-ups, at least 101 rows and 3 columns. New sign-ups insert below the header. Counts cover the first 100 entries, not an unlimited or unique-voter poll.`,
    bounds: [101, 3],
    rows: () => [['Entry ID', 'City', 'Joined at'],
      ...['Taipei', 'Tokyo', 'Singapore', 'London', 'Berlin', 'Sydney', 'Seoul', 'Toronto'].flatMap((city, i) =>
        Array.from({ length: 14 - i }, (_, j) => [`HELLO-${i}-${j}`, city, `2026-11-${String(14 - (j % 7)).padStart(2, '0')}T09:00:00Z`]))],
    ready: `document.querySelectorAll('#leaders .rank').length === 8 && document.querySelector('#count')?.textContent.startsWith('84 hellos')`,
  },
};
function layoutFor(html, id) {
  const header = html.match(/<!--([\s\S]*?)-->/)?.[1];
  const expected = header?.match(/Expected Sheet:\s*([\s\S]*?)\s*Replace EVERY/)?.[1];
  const entry = Object.entries(layouts).find(([, layout]) => normalize(layout.expected) === normalize(expected ?? ''));
  assert(entry, `${id}: unsupported Expected Sheet layout. Add a seeder for this header before generating thumbnails.\n${expected ?? 'Missing header'}`);
  return entry[0];
}
function bindIds(html, unit, sheet) {
  return html.split(/(<script\b[^>]*>[\s\S]*?<\/script>)/gi).map(part => {
    const raw = /^<script\b/i.test(part);
    return part.replaceAll('REPLACE_UNIT_ID', raw ? unit : encodeURIComponent(unit))
      .replaceAll('REPLACE_SHEET_ID', raw ? sheet : encodeURIComponent(sheet));
  }).join('');
}
const styles = readdirSync(templates).filter(file => file.endsWith('.univer.html')).sort().map(file => {
  const html = readFileSync(join(templates, file), 'utf8');
  const id = file.slice(0, -'.univer.html'.length);
  return { id, html, layout: layoutFor(html, id) };
});
assert(styles.length > 0, 'No HTML View templates found');
if (process.argv.includes('--self-test')) {
  assert.throws(() => layoutFor('<!-- Expected Sheet: unknown. Replace EVERY X -->', 'future'), /unsupported Expected Sheet layout/);
  assert.throws(() => layoutFor(styles[0].html.replace('201', '301'), 'changed'), /unsupported Expected Sheet layout/);
  const bound = bindIds('<div data-univer-cell-text="REPLACE_UNIT_ID:REPLACE_SHEET_ID:A1"></div><script>const u="REPLACE_UNIT_ID",s="REPLACE_SHEET_ID";</script>', 'a/b', 'c:d');
  assert(bound.includes('a%2Fb:c%3Ad:A1'));
  assert(bound.includes('u="a/b",s="c:d"'));
  const runway = layouts.runway.rows();
  assert.equal(runway.length, 44);
  assert(runway.slice(8).every(row => row.length === 5 && row.every(value => value.startsWith('='))));
  for (const layout of Object.values(layouts)) {
    const rows = layout.rows();
    assert(rows.length <= layout.bounds[0]);
    assert(rows.every(row => row.length === layout.bounds[1]));
  }
  console.log(`Self-test passed: ${styles.length} templates, four layouts, unknown/changed layout rejection, ID encoding, 36 formula rows.`);
  process.exit(0);
}
const { VERIFY_UVW_RUN, UNIVER_HOME, ORIGIN, EVIDENCE, AGENT_BROWSER_SESSION } = process.env;
assert(VERIFY_UVW_RUN && UNIVER_HOME && ORIGIN && EVIDENCE && AGENT_BROWSER_SESSION, usage);
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(ORIGIN), 'Only a disposable loopback verify-uvw origin is allowed');
const run = dirname(UNIVER_HOME);
assert.equal(resolve(UNIVER_HOME), join(run, 'home'));
assert.equal(dirname(EVIDENCE), run);
assert(readFileSync(join(run, 'run.env'), 'utf8').includes(`RUN_ID=${VERIFY_UVW_RUN}`), 'Run identity mismatch');
function command(executable, args, input) {
  return execFileSync(executable, args, { cwd: root, encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}
const evidence = join(EVIDENCE, 'style-thumbnails');
mkdirSync(evidence, { recursive: true });
mkdirSync(output, { recursive: true });
writeFileSync(join(evidence, 'doctor.txt'), command(helper, ['doctor']));
const uvw = (...args) => JSON.parse(command(helper, ['uvw', ...args, '--json']));
const browser = (...args) => command('agent-browser', args);
const repositories = uvw('repo', 'list', '--owner', '@me', '--type', 'personal');
assert.equal(repositories.length, 1, 'Expected one disposable personal repository');
const { id: space, fullName: repo } = repositories[0];
assert.equal(repo, `verify-${VERIFY_UVW_RUN}/personal`, 'Refusing to seed a non-default verification user');
const pr = uvw('pr', 'create', '-R', repo, '-t', 'HTML View style thumbnails');
const sources = {};
for (const key of new Set(styles.map(style => style.layout))) {
  console.log(`Seeding ${key}`);
  const layout = layouts[key], rows = layout.rows();
  const unit = uvw('unit', 'create', '--worktree', pr.id, '--space', space, '--type', 'sheet', '--name', `Style thumbnail ${key}`).unit.unitId;
  const result = uvw('execute', '--worktree', pr.id, '--unit', unit, '-e', `
    const ws = workbook.getSheets()[0];
    ws.setName(${JSON.stringify(key)});
    if (ws.getMaxRows() < ${layout.bounds[0]}) ws.setRowCount(${layout.bounds[0]});
    ws.getRange(0, 0, ${rows.length}, ${layout.bounds[1]}).setValues(${JSON.stringify(rows)});
    ${key === 'runway' ? 'const calculated = api.getFormula().onCalculationResultApplied(); api.getFormula().executeCalculation(); await calculated;' : ''}
    return { sheet: ws.getSheetId(), values: ws.getRange(0, 0, ${rows.length}, ${layout.bounds[1]}).getValues() };
  `);
  assert.equal(result.committed, true, `${key}: seed did not commit`);
  if (key === 'runway') {
    assert(result.value.values.slice(8).every(row => row.every(value => typeof value === 'number' && Number.isFinite(value))), 'All 36 formula rows must be calculated');
    assert.equal(result.value.values[8][4], 3020000);
  } else assert.deepEqual(result.value.values, rows);
  sources[key] = { unit, sheet: result.value.sheet };
  writeFileSync(join(evidence, `${key}-seed.json`), JSON.stringify(result, null, 2));
}
uvw('pr', 'ready', String(pr.number), '-R', repo);
assert.equal(uvw('pr', 'merge', String(pr.number), '-R', repo).state, 'merged');
for (const [key, { unit, sheet }] of Object.entries(sources)) {
  const readback = uvw('inspect', 'range', key === 'runway' ? 'A1:E44' : `A1:${String.fromCharCode(64 + layouts[key].bounds[1])}${layouts[key].rows().length}`, '--trunk', '--unit', unit, '--worksheet', `id:${sheet}`);
  writeFileSync(join(evidence, `${key}-trunk.json`), JSON.stringify(readback, null, 2));
  const cells = readback.ranges[0].cellData;
  const sampleColumn = key === 'sales' ? 3 : 1;
  assert.equal(cells[1][sampleColumn].v, layouts[key].rows()[1][sampleColumn]);
  if (key === 'runway') {
    assert(cells.slice(8).every(row => row.every(cell => typeof cell.v === 'number' && Number.isFinite(cell.v))), 'Trunk must preserve 36 calculated months');
    assert(cells.slice(8).every(row => row.every(cell => cell.f?.startsWith('='))), 'Trunk must preserve the Sheet formulas');
  }
}
browser('set', 'viewport', '1280', '800');
browser('open', `${ORIGIN}/login`);
browser('storage', 'local', 'set', 'univer-workspace-language', 'en-US');
browser('reload');
browser('wait', '--fn', "!!document.querySelector('form') || location.pathname === '/home'");
if (JSON.parse(browser('eval', 'fetch("/api/session").then(r => r.json()).then(s => s.authenticated)')) !== true) {
  browser('find', 'label', 'Username', 'fill', `verify-${VERIFY_UVW_RUN}`);
  try { browser('find', 'label', 'Password', 'fill', readFileSync(join(run, 'user.pw'), 'utf8').trim()); }
  catch { throw new Error('Could not fill the disposable password'); }
  browser('click', 'form button[type=submit]');
  browser('wait', '--url', '**/home');
}
assert.equal(JSON.parse(browser('eval', 'fetch("/api/session").then(r => r.json()).then(s => s.user?.username)')), `verify-${VERIFY_UVW_RUN}`);
const manifest = [];
try {
  for (const style of styles) {
    console.log(`Rendering ${style.id}`);
    const { unit, sheet } = sources[style.layout];
    const html = bindIds(style.html, unit, sheet);
    assert(!/REPLACE_(UNIT|SHEET)_ID/.test(html));
    const file = join(evidence, `${style.id}.univer.html`);
    writeFileSync(file, html);
    const validation = uvw('html-view', 'validate', '--file', file);
    assert.equal(validation.valid, true);
    assert(validation.bindingCount > 0);
    writeFileSync(join(evidence, `${style.id}-validation.json`), JSON.stringify(validation, null, 2));
    const key = createHash('sha256').update(space + style.id + html).digest('hex');
    const page = uvw('html-view', 'create', '--file', file, '--space', space, '--name', style.id, '--idempotency-key', key);
    assert.equal(new URL(page.shareUrl).origin, ORIGIN);
    assert.equal(new URL(page.shareUrl).searchParams.get('view'), 'immersive');
    browser('open', page.shareUrl);
    const ready = `(() => { const text = document.body?.innerText ?? ''; return document.fonts.status === 'loaded' && !/Loading|Counting entries|Could not load|Unable to load|Chart unavailable|No monthly data|Waiting for|No sales records/i.test(text) && !document.querySelector('[data-s="rejected"],[data-s="error"],[data-error="true"]') && (${layouts[style.layout].ready}); })()`;
    // agent-browser's CSS frame selector cannot reach the SDK's shadow-root iframe.
    const socket = new WebSocket(browser('get', 'cdp-url').trim());
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    const pending = new Map();
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      const request = pending.get(message.id);
      if (request) { pending.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result); }
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    try {
      const { targetInfos } = await send('Target.getTargets');
      const target = targetInfos.find(target => target.type === 'page' && target.url === page.shareUrl);
      assert(target, `${style.id}: immersive browser tab missing`);
      let iframe;
      for (let attempt = 0; attempt < 100; attempt++) {
        const targets = await send('Target.getTargets');
        iframe = targets.targetInfos.find(child => child.type === 'iframe' && child.parentId === target.targetId && child.url === 'about:srcdoc');
        if (iframe) break;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      assert(iframe, `${style.id}: HTML View iframe missing`);
      const { sessionId } = await send('Target.attachToTarget', { targetId: iframe.targetId, flatten: true });
      const rpc = (method, params) => send(method, params, sessionId);
      const { executionContextId } = await rpc('Page.createIsolatedWorld', { frameId: iframe.targetId, worldName: 'thumbnail-readback' });
      const evaluate = async expression => {
        const response = await rpc('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
        assert(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
        return response.result.value;
      };
      let rendered = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(ready)) { rendered = true; break; }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      const text = await evaluate('document.body.innerText');
      writeFileSync(join(evidence, `${style.id}-rendered.txt`), text);
      assert(rendered, `${style.id}: bound layout did not render. See ${evidence}/${style.id}-rendered.txt. CDN libraries/fonts must load.`);
      await evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
      // ECharts has a 500-700ms entrance animation after data arrives.
      if (style.layout === 'sales') browser('wait', '900');
    } finally { socket.close(); }
    const png = join(evidence, `${style.id}.png`);
    browser('screenshot', png);
    const webp = join(output, `${style.id}.webp`);
    command('cwebp', ['-quiet', '-q', '80', '-resize', '640', '400', png, '-o', webp]);
    assert(statSync(webp).size < 60000, `${style.id}: WebP must be below 60 KB`);
    const item = { id: style.id, layout: style.layout, source: sources[style.layout], page, bytes: statSync(webp).size };
    manifest.push(item);
    writeFileSync(join(evidence, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`${style.id}: 640x400, ${item.bytes} bytes`);
  }
  assert.equal(manifest.length, styles.length);
  console.log(`Generated ${manifest.length} thumbnails. Inspect every WebP before accepting. Evidence: ${evidence}`);
} finally {
  browser('close');
}
