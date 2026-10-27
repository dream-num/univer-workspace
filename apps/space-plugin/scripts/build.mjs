import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { scopeSdkCss } from './scope-sdk-css.mjs';
import { releaseSdkDefaults } from './release-sdk-defaults.mjs';
import { readFile, writeFile, mkdir, copyFile, rm, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
await rm('lib', { recursive: true, force: true });
await mkdir('lib', { recursive: true });
const sdkCss = await Promise.all(
  [
    '@univerjs/preset-docs-core',
    '@univerjs/preset-docs-hyper-link',
    '@univerjs-pro/docs-callout-ui',
    '@univerjs-pro/docs-chart-ui',
    '@univerjs-pro/docs-code-ui',
    '@univerjs-pro/docs-latex-ui',
    '@univerjs-pro/docs-print',
    '@univerjs-pro/docs-shape-ui',
    '@univerjs-pro/docs-table-ui',
    '@univerjs/preset-sheets-core',
    '@univerjs/preset-sheets-conditional-formatting',
    '@univerjs/preset-sheets-data-validation',
    '@univerjs/preset-sheets-filter',
    '@univerjs/preset-sheets-find-replace',
    '@univerjs/preset-sheets-hyper-link',
    '@univerjs/preset-sheets-note',
    '@univerjs/preset-sheets-sort',
    '@univerjs/preset-sheets-table',
    '@univerjs/preset-sheets-advanced',
    '@univerjs/preset-sheets-collaboration',
    '@univerjs-pro/sheets-history-ui',
    '@univerjs/drawing-ui',
    '@univerjs-pro/slides-ui',
    '@univerjs/design',
    '@univerjs/ui',
    '@univerjs/docs-ui',
    '@univerjs-pro/chart-ui',
    '@univerjs-pro/shape-editor-ui',
    '@univerjs-pro/slides-chart-ui',
    '@univerjs-pro/slides-print',
    '@univerjs-pro/slides-table-ui',
    '@univerjs-pro/slides-thread-comment-ui',
    '@univerjs-pro/edit-history-ui',
    '@univerjs-pro/embed-ui',
    '@univerjs-pro/exchange-client',
    '@univerjs/thread-comment-ui',
    '@univerjs-pro/boards-ui',
    '@univerjs-pro/ink-ui',
    '@univerjs-pro/docs-latex-ui',
    '@univerjs-pro/boards-chart-ui',
    '@univerjs-pro/boards-history-ui',
    '@univerjs-pro/boards-mind-ui',
    '@univerjs-pro/boards-print',
    '@univerjs-pro/boards-table-ui',
    '@univerjs-pro/boards-thread-comment-ui',
    '@univerjs-pro/bases-ui',
    '@univerjs-pro/bases-history-ui',
    '@univerjs-pro/bases-thread-comment-ui',
    '@univerjs-pro/bases-exchange-client',
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
// The Host treats packages as external, but HTML View is a build dependency.
// Bundle it with its own dependency graph so installed plugins do not depend on
// the private Labs registry or on development-only node_modules.
const htmlViewBundle = (await build({
  entryPoints: [fileURLToPath(import.meta.resolve('@univerjs-labs/html-view'))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  write: false,
  logLevel: 'silent',
})).outputFiles[0].text;
// DSH public Tools types are erased. The Host owns the single Tools service.
await build({
  entryPoints: [
    'src/index.ts',
    'src/oauth.ts',
    'src/workspace.ts',
    'src/model.ts',
    'src/file-reference.ts',
    'src/turn-files.ts',
    'src/tools.ts',
    'src/editing.ts',
    'src/api-tool.ts',
    'src/creation-tools.ts',
    'src/exchange-tools.ts',
    'src/blob-tool.ts',
    'src/html-view-tool.ts',
    'src/svg-tool.ts',
    'src/skills.ts',
    'src/resources-tool.ts',
    'src/issue-tool.ts',
    'src/lint-tool.ts',
    'src/screenshot-tool.ts',
    'src/status-tool.ts',
    'src/unit-tool.ts',
    'src/viewer-data.ts',
    'src/host-layout.ts',
    'src/editor-http.ts',
  ],
  outdir: 'lib',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  splitting: true,
  plugins: [{ name: 'bundle-shared-content-runtime', setup(build) {
    build.onResolve({ filter: /^@univerjs-labs\/html-view$/ }, () => ({ path: 'html-view', namespace: 'space-html-view' }));
    build.onLoad({ filter: /.*/, namespace: 'space-html-view' }, () => ({ contents: htmlViewBundle, loader: 'js' }));
    build.onResolve({ filter: /^@univerjs\/univer-workspace-agent-runtime(?:\/(?:api-reference|workspace-spaces|workspace-resources|workspace-exchange|workspace-session-path|workspace-inspection|workspace-blob|workspace-html-view|workspace-svg|workspace-skill-resources|workspace-resource-library|workspace-issues|workspace-issue-operations|workspace-render|workspace-screenshot|workspace-file-state-api|workspace-worktree-api|workspace-state|workspace-status|workspace-unit-operations))?$/ }, (args) => ({ path: fileURLToPath(import.meta.resolve(args.path)) }));
  } }],
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
  plugins: [releaseSdkDefaults()],
  loader: { '.css': 'text' },
  banner: {
    js: 'window.__ModuleLoader__.load({id:"dsh-space-plugin",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: { js: 'return module.exports;}});' },
  logLevel: 'info',
});

// Public shared runtime artifacts are packaged with the plugin. No file: path
// or second DSH cohort is required in an installed Host profile.
await copyFile(fileURLToPath(import.meta.resolve('@univerjs/univer-workspace-agent-runtime/worker')), 'lib/workspace-content-worker.js');
await copyFile(fileURLToPath(import.meta.resolve('@univerjs/univer-workspace-agent-runtime/worker-child')), 'lib/worker-child.mjs');
await copyFile(fileURLToPath(import.meta.resolve('@univerjs/univer-workspace-agent-runtime/worker-child-upstream')), 'lib/worker-child-upstream.mjs');

// The original Browser Base formula worker, served through the existing owner-only Connection.
await build({ entryPoints: ['src/base-worker.ts'], outfile: 'lib/base-editor-worker.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'info' });

// Preserve the original Workspace Skill bodies, references and templates in the installed plugin.
await cp('../../packages/dsh-univer-workspace-plugin/skills', 'lib/skills', { recursive: true });

await copyFile(fileURLToPath(import.meta.resolve('@univerjs-pro/cli-assets/manifest.json')), 'lib/resource-manifest.json');

// The same version-matched Render Page used by the original Workspace Agent.
execFileSync('pnpm', ['exec', 'vite', 'build', '--config', 'render-runtime/vite.config.ts'], { cwd: '../../packages/client-core', stdio: 'inherit' });
await cp('../../packages/client-core/dist/render-runtime', 'lib/render-runtime', { recursive: true });
