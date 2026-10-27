import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
await mkdir('lib', { recursive: true });
const external = ['node:*', '@univerjs-pro/engine-formula-rust-binding', '@univerjs-pro/exchange-node-binding', '@univer-cli/unit-layout-lint', '@univer-cli/unit-screenshot', '@univer-cli/univer-render-runtime'];
for (const [entry, outfile] of [['src/api-reference.ts', 'lib/api-reference.js'], ['src/manager.ts', 'lib/index.js'], ['src/manager.ts', 'lib/manager.js'], ['src/target.ts', 'lib/target.js'], ['src/worker-http.ts', 'lib/worker-http.js'], ['src/snapshot-adapter.ts', 'lib/snapshot-adapter.js'], ['src/worker.ts', 'lib/worker.js']]) {
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node24', external, logLevel: 'info' });
}
await build({
  entryPoints: ['src/workspace/index.ts', 'src/workspace/api-errors.ts', 'src/workspace/wire.ts', 'src/workspace/resources-api.ts', 'src/workspace/json-value.ts', 'src/workspace/local-exchange.ts', 'src/workspace/session-path.ts', 'src/workspace/inspection.ts', 'src/workspace/blob-api.ts', 'src/workspace/html-view.ts', 'src/workspace/svg-operations.ts', 'src/workspace/skill-resources.ts', 'src/workspace/resource-library.ts', 'src/workspace/issues-api.ts', 'src/workspace/issue-operations.ts', 'src/workspace/render-operations.ts'],
  outdir: 'lib/workspace', bundle: true, splitting: true, platform: 'node', format: 'esm', target: 'node24', external, logLevel: 'info',
});
const pool = import.meta.resolve('@univer-cli/univer-collaboration-runtime-pool');
await copyFile(fileURLToPath(new URL('./worker-child.mjs', pool)), 'lib/worker-child-upstream.mjs');
await copyFile('src/worker-child-bootstrap.mjs', 'lib/worker-child.mjs');
