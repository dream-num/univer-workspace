import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

// Runtime source and Skills can include TypeScript. Only declarations and
// explicit development-only directories from known published packages are cut.
const developmentDirectories = {
  '@mixmark-io/domino': ['test'],
  '@modelcontextprotocol/sdk': ['dist/cjs/examples', 'dist/esm/examples'],
  zod: ['src'],
  '@anthropic-ai/sdk': ['src'],
  openai: ['src'],
};
export async function trimDevelopmentFiles(modules) {
  const browserBuilds = [];
  async function visit(path) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const child = join(path, item.name);
      if (item.isFile() && item.name === 'package.json') {
        const manifest = JSON.parse(await readFile(child, 'utf8'));
        // These SDKs publish parallel bundler outputs. Native Node uses main
        // when no exports map exists. Preserve every exports-mapped package.
        if (!manifest.exports && manifest.name?.startsWith('@opentelemetry/') &&
            manifest.main === 'build/src/index.js' && manifest.module === 'build/esm/index.js')
          browserBuilds.push(join(path, 'build/esm'), join(path, 'build/esnext'));
        if (!manifest.exports && manifest.name?.startsWith('@smithy/') &&
            manifest.main?.replace(/^\.\//, '') === 'dist-cjs/index.js' &&
            manifest.module?.replace(/^\.\//, '') === 'dist-es/index.js')
          browserBuilds.push(join(path, 'dist-es'));
      }
      if (item.isFile() && (/\.d\.(?:ts|mts|cts)$/.test(item.name) || item.name.endsWith('.pdb'))) await rm(child);
      else if (item.isDirectory()) await visit(child);
    }
  }
  await visit(modules);
  for (const path of browserBuilds) await rm(path, { recursive: true, force: true });
  for (const [name, paths] of Object.entries(developmentDirectories)) {
    for (const path of paths) await rm(join(modules, name, path), { recursive: true, force: true });
  }
}
