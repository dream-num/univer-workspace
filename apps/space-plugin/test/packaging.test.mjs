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
