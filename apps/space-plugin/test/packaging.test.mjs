import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { registerReadTools } from '../lib/tools.js';
test('formal read-tool wire schemas and presentation remain compatible', async () => {
  const ds = [];
  registerReadTools(
    {
      tools: {
        register: (d) => {
          ds.push(d);
          return () => {};
        },
      },
    },
    {},
    {},
  );
  const contracts = ds.map((d) => ({
    name: d.name,
    description: d.description,
    parameters: d.parameters,
    output: d.output.schema,
    presentation: d.presentCall?.({ nodeId: 'n' }),
  }));
  assert.deepEqual(
    JSON.parse(JSON.stringify(contracts)),
    JSON.parse(
      await readFile(
        new URL('fixtures/read-tools.contract.json', import.meta.url),
        'utf8',
      ),
    ),
  );
});
test('published plugin cannot install a second DSH Tools runtime or scheduler Symbol', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.dependencies['@deepseek-ai/dsh-tools'], undefined);
  const hostEntries = (await readdir('lib')).filter(name => name.endsWith('.js') && !['client.js', 'workspace-content-worker.js'].includes(name));
  assert.ok(hostEntries.some(name => name.startsWith('chunk-')));
  for (const name of hostEntries) {
    const text = await readFile(`lib/${name}`, 'utf8');
    assert.doesNotMatch(
      text,
      /@deepseek-ai\/dsh-tools|TOOL_RUNTIME_SCHEDULER|ToolRuntime/,
    );
  }
});

test('built code contains no inline development license, local checkout paths or SDK service fallback', async () => {
  const source = await readFile('../../apps/workspace/web/src/features/editor/features/license.ts', 'utf8');
  const credential = JSON.parse(source.match(/export const UNIVER_LICENSE\s*=\s*("[^"]+")/)[1]);
  for (const name of (await readdir('lib')).filter(name => /\.(m?js|css)$/.test(name))) {
    const content = await readFile(`lib/${name}`, 'utf8');
    assert.ok(!content.includes(credential), `${name}: development license must not be bundled`);
    assert.ok(!/\/Users\/|\/private\/tmp\/task|\/tmp\/task/.test(content), `${name}: local checkout or test path`);
    assert.ok(!content.includes('ws://127.0.0.1:8000'), `${name}: SDK development service fallback`);
    assert.ok(!content.includes('TASK010_PREVIEW_'), `${name}: temporary diagnostic instrumentation`);
  }
});

test('installed Host packages the original shared content worker without a file dependency or second DSH cohort', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.dependencies['@univerjs/univer-workspace-agent-runtime'], undefined);
  assert.ok(Object.values(pkg.dependencies).every(value => !value.startsWith('file:')));
  assert.ok(Object.keys(pkg.dependencies).every(name => !name.startsWith('@deepseek-ai/')));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const [entry, output] of [['worker', 'workspace-content-worker.js'], ['worker-child', 'worker-child.mjs'], ['worker-child-upstream', 'worker-child-upstream.mjs']]) {
    assert.equal(hash(await readFile(`lib/${output}`)), hash(await readFile(fileURLToPath(import.meta.resolve(`@univerjs/univer-workspace-agent-runtime/${entry}`)))));
  }
});

test('Base formula worker is served from the installed plugin over the owner Connection', async () => {
  const { apply } = await import('../lib/index.js');
  const routes = [], disposers = [];
  apply({
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); },
    on() {}, tools: { register() { return () => {}; } },
    inject(_deps, callback) { callback(this); }, skills: { registerProvider() { return () => {}; } },
    connection: { fetch: { register(route) { routes.push(route); return async () => {}; } } },
    systemPrompt: { context() { return () => {}; } },
    credentials: { readRecord: async () => undefined, modifyRecord: async () => {} },
  });
  try {
    const route = routes.find((entry) => entry.path === '/api/space/base-worker');
    assert.ok(route);
    assert.deepEqual(route.methods, ['GET']);
    const response = await route.fetch(new Request('http://localhost/api/space/base-worker'));
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash(await response.text()), hash(await readFile('lib/base-editor-worker.js')));
  } finally {
    for (const dispose of disposers.reverse()) await dispose();
  }
});
