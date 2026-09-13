import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

// Runtime source and Skills can include TypeScript. Only declarations and
// explicit development-only directories from known published packages are cut.
const developmentDirectories = {
  '@mixmark-io/domino': ['test'],
  '@modelcontextprotocol/sdk': ['dist/cjs/examples', 'dist/esm/examples'],
  zod: ['src'],
  '@anthropic-ai/sdk': ['src'],
};
export async function trimDevelopmentFiles(modules) {
  async function visit(path) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const child = join(path, item.name);
      if (item.isFile() && (/\.d\.(?:ts|mts|cts)$/.test(item.name) || item.name.endsWith('.pdb'))) await rm(child);
      else if (item.isDirectory()) await visit(child);
    }
  }
  await visit(modules);
  for (const [name, paths] of Object.entries(developmentDirectories)) {
    for (const path of paths) await rm(join(modules, name, path), { recursive: true, force: true });
  }
}
