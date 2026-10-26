import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
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
  for (const name of ['index', 'tools']) {
    const text = await readFile(`lib/${name}.js`, 'utf8');
    assert.doesNotMatch(
      text,
      /@deepseek-ai\/dsh-tools|TOOL_RUNTIME_SCHEDULER|ToolRuntime/,
    );
  }
});
