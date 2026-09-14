import { createRequire } from 'node:module';
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [runtimeArgument, directoryArgument] = process.argv.slice(2);
if (!runtimeArgument || !directoryArgument) throw new Error('Usage: node prepare.mjs <packaged-runtime> <new-probe-directory>');
const runtime = resolve(runtimeArgument), directory = resolve(directoryArgument);
await readFile(join(runtime, 'integrity.json'));
// A new directory prevents overwriting an existing experiment or installation.
await mkdir(directory);
const stage = join(directory, 'stage');
await cp(join(runtime, 'bootstrap'), stage, { recursive: true, dereference: true });
await cp(join(runtime, 'home/profiles/univer-workspace-harness'), join(stage, 'profile'),
  { recursive: true, dereference: true });
// Preserve both dependency graphs and their versions. Physical root node_modules
// provides profile fallback resolution without a junction into a virtual ASAR.
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
await builderRequire('@electron/asar').createPackageWithOptions(stage, join(directory, 'host.asar'),
  { unpack: '**/*.{node,exe,dll,so,dylib}' });
for (const file of ['host.cjs', 'service.cjs', 'capability-host.cjs', 'capabilities.cjs']) {
  await cp(join(here, file), join(directory, file));
}
await cp(join(here, '../../src/browser-cache.cjs'), join(directory, 'browser-cache.cjs'));
await cp(join(here, '../../test/packaged-capability.mjs'), join(directory, 'packaged-capability.mjs'));
await writeFile(join(directory, 'probe.json'), JSON.stringify({ runtime }, null, 2));
const files = (await readdir(join(directory, 'host.asar.unpacked'), { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile());
const report = { archiveBytes: (await stat(join(directory, 'host.asar'))).size, unpackedFiles: files.length };
await writeFile(join(directory, 'pack-result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
