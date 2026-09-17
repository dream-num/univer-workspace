import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** DSH plugin add records absolute tarball specifiers; artifacts must relocate. */
export async function makeProfilePortable(profile, dshVersions = {}) {
  const manifestPath = join(profile, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  // Installed only when the user runs pnpm install. Default launches continue
  // to use the compact, prebuilt host shipped in ASAR.
  manifest.dependencies['@deepseek-ai/dsh'] = manifest.dependencies['@deepseek-ai/dsh-web-app'];
  // Keep a later plugin install on the DSH graph that this artifact validated.
  // Published packages use caret ranges, which can otherwise select a newer RC.
  manifest.pnpm = { ...manifest.pnpm, overrides: { ...manifest.pnpm?.overrides, ...dshVersions } };
  let lock = await readFile(join(profile, 'pnpm-lock.yaml'), 'utf8');
  for (const [name, specifier] of Object.entries(manifest.dependencies ?? {})) {
    if (!specifier.startsWith('file:')) continue;
    const file = basename(specifier.replaceAll('\\', '/'));
    if (!file.endsWith('.tgz')) throw new Error(`Desktop dependency is not a packaged tarball: ${name}`);
    await access(join(profile, '../../internal-packages', file));
    const portable = `file:../../internal-packages/${file}`;
    manifest.dependencies[name] = portable;
    lock = lock.replaceAll(specifier, portable);
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(profile, 'pnpm-lock.yaml'), lock);
}
