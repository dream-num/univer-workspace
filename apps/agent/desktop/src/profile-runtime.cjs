const { readFile, access, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

// An installed, writable DSH profile owns its own complete dependency graph.
// Do not mix arbitrary plugins into the precompiled ASAR/browser composition.
async function selectProfileRuntime(resources, home) {
  const profile = join(home, 'profiles/univer-workspace-harness');
  const dsh = join(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
  let installed = false;
  try { await access(dsh); installed = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!installed) {
    for (const name of ['package.json', 'cordis.patch.yml']) {
      if (!(await readFile(join(profile, name))).equals(await readFile(join(resources, 'home/profiles/univer-workspace-harness', name))))
        throw new Error(`Plugin configuration changed. Run pnpm install in ${profile}, then restart Workspace Agent.`);
    }
    return { archived: true };
  }
  // An application overlay comes after the user's patch. DSH composes browser
  // entries for the installed roster using its published module service.
  const patch = join(home, 'desktop-plugins.patch.yml');
  await writeFile(patch, '- id: workspace-desktop-client\n  disabled: true\n- id: modules\n  disabled: false\n- id: hmr\n  disabled: true\n- id: client-hmr\n  disabled: true\n');
  return { archived: false, dsh, patch };
}

module.exports = { selectProfileRuntime };
