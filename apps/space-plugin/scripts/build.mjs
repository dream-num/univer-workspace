import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('lib', { recursive: true });
await build({ entryPoints: ['src/index.ts', 'src/workspace.ts'], outdir: 'lib', bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node24', logLevel: 'info' });
await build({ entryPoints: ['src/client.tsx'], outfile: 'lib/client.js', bundle: true, format: 'cjs', platform: 'browser', external: ['react', 'react/jsx-runtime'], target: 'es2022',
  banner: { js: 'window.__ModuleLoader__.load({id:"dsh-space-plugin",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
  footer: { js: 'return module.exports;}});' }, logLevel: 'info' });
