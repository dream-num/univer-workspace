import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { scopeSdkCss } from './scope-sdk-css.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
await mkdir('lib', { recursive: true });
const sdkCss = await Promise.all(
  [
    '@univerjs/preset-docs-core',
    '@univerjs/preset-sheets-core',
    '@univerjs/drawing-ui',
    '@univerjs-pro/slides-ui',
    '@univerjs-pro/boards-ui',
    '@univerjs-pro/bases-ui',
    '@univerjs-pro/collaboration-client-ui',
    '@univerjs/preset-docs-thread-comment',
    '@univerjs/preset-docs-drawing',
    '@univerjs/preset-sheets-drawing',
    '@univerjs/preset-sheets-thread-comment',
  ].map((name) => readFile(`node_modules/${name}/lib/index.css`, 'utf8')),
);
await writeFile('lib/univer-scoped.css', sdkCss.map(scopeSdkCss).join('\n'));
execFileSync(
  process.execPath,
  [
    'node_modules/tailwindcss/lib/cli.js',
    '-i',
    'src/tailwind.css',
    '-o',
    'lib/tailwind.css',
    '--minify',
  ],
  { stdio: 'inherit' },
);
// DSH public Tools types are erased. The Host owns the single Tools service.
await build({
  entryPoints: [
    'src/index.ts',
    'src/workspace.ts',
    'src/model.ts',
    'src/file-reference.ts',
    'src/tools.ts',
    'src/viewer-data.ts',
    'src/host-layout.ts',
    'src/editor-http.ts',
  ],
  outdir: 'lib',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node24',
  logLevel: 'info',
});
await build({
  entryPoints: ['src/client.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  target: 'es2022',
  loader: { '.css': 'text' },
  banner: {
    js: 'window.__ModuleLoader__.load({id:"dsh-space-plugin",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: { js: 'return module.exports;}});' },
  logLevel: 'info',
});
