import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** The generated profile is an isolated pnpm project, including after relocation. */
export async function writeProfileWorkspace(profile, overrides = {}) {
  // JSON is valid YAML. Keep both preparation and the shipped profile on the
  // same pnpm 11 configuration, which no longer reads package.json.pnpm.
  await writeFile(join(profile, 'pnpm-workspace.yaml'), JSON.stringify({
    nodeLinker: 'hoisted',
    enableGlobalVirtualStore: false,
    minimumReleaseAge: 0,
    allowBuilds: {
      esbuild: true, 'node-pty': true, koffi: true,
      '@deepseek-ai/dsh-subprocess-local': true,
      'node-addon-require-builtin': false, protobufjs: false, '@google/genai': false,
    },
    overrides,
  }, null, 2) + '\n');
}

/** DSH plugin add records absolute tarball specifiers; artifacts must relocate. */
export async function makeProfilePortable(profile, dshVersions = {}) {
  const manifestPath = join(profile, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  // Installed only when the user runs pnpm install. Default launches continue
  // to use the compact, prebuilt host shipped in ASAR.
  manifest.dependencies['@deepseek-ai/dsh'] = manifest.dependencies['@deepseek-ai/dsh-web-app'];
  // Keep a later plugin install on the DSH graph that this artifact validated.
  // Published packages use caret ranges, which can otherwise select a newer RC.
  await writeProfileWorkspace(profile, { ...manifest.pnpm?.overrides, ...dshVersions });
  if (manifest.pnpm) {
    delete manifest.pnpm.overrides;
    if (!Object.keys(manifest.pnpm).length) delete manifest.pnpm;
  }
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
