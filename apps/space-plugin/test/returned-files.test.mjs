import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('native turn-tail list owner renders no files or actual returned references without a chain match', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-returned-files-'));
  try {
    const result = await build({
      entryPoints: ['src/components/returned-files.tsx'], bundle: true, platform: 'node', format: 'esm', write: false,
      plugins: [{ name: 'consumer-react', setup(bundler) {
        bundler.onResolve({ filter: /^(react(?:\/.*)?|lucide-react)$/ }, args => ({ path: fileURLToPath(import.meta.resolve(args.path)), external: true }));
      } }],
    });
    const entry = join(directory, 'component.mjs');
    await writeFile(entry, result.outputFiles[0].contents);
    const { ReturnedFiles } = await import(pathToFileURL(entry));
    const render = value => renderToStaticMarkup(React.createElement(ReturnedFiles, {
      turn: { data: { get: key => key === 'spaceReturnedFiles' ? value : undefined } },
      sessionId: 'native-session', openFile: async () => {},
    }));
    assert.equal(render(undefined), '');
    assert.equal(render({ files: [] }), '');
    const html = render({ files: [{ label: 'Generated Doc', nodeId: 'node', resourceId: 'resource', unitId: 'unit' }] });
    assert.match(html, /Open Space file: Generated Doc/);
    assert.match(html, /data-workspace-reference="node"/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
