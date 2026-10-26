import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
await mkdir('lib', { recursive: true });
const external = ['node:*', '@univerjs-pro/engine-formula-rust-binding', '@univerjs-pro/exchange-node-binding'];
for (const [entry, outfile] of [['src/manager.ts', 'lib/index.js'], ['src/manager.ts', 'lib/manager.js'], ['src/target.ts', 'lib/target.js'], ['src/worker-http.ts', 'lib/worker-http.js'], ['src/snapshot-adapter.ts', 'lib/snapshot-adapter.js'], ['src/worker.ts', 'lib/worker.js']]) {
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node24', external, logLevel: 'info' });
}
const pool = import.meta.resolve('@univer-cli/univer-collaboration-runtime-pool');
await copyFile(fileURLToPath(new URL('./worker-child.mjs', pool)), 'lib/worker-child-upstream.mjs');
await copyFile('src/worker-child-bootstrap.mjs', 'lib/worker-child.mjs');
