// DSH rewrites profile configuration and heals module fallbacks at boot. Keep
// those few writable entries in userData; execute shipped code in resources.
const { mkdir, readdir, readFile, writeFile, cp, symlink, rename, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { createHash } = require('node:crypto');

async function prepareRuntimeHome(source, target) {
  const identity = createHash('sha256')
    .update(resolve(source)).update('\0')
    .update(await readFile(join(source, 'integrity.json'))).digest('hex');
  try {
    if (await readFile(join(target, '.desktop-complete'), 'utf8') === identity) {
      // The prebuilt browser graph belongs to this fixed Desktop roster.
      for (const name of ['package.json', 'cordis.patch.yml']) {
        const file = join('profiles/univer-workspace-harness', name);
        if (!(await readFile(join(target, file))).equals(await readFile(join(source, 'home', file))))
          throw new Error('Desktop plugin configuration differs from its packaged client; restore the packaged profile before starting');
      }
      return target;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const staging = `${target}.staging`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  // Link packages individually: DSH must be able to add fallback links to the
  // writable node_modules directory without writing inside the installation.
  async function linkPackages(from, to) {
    await mkdir(to, { recursive: true });
    for (const item of await readdir(from, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      if (item.name.startsWith('@')) await linkPackages(join(from, item.name), join(to, item.name));
      else await symlink(resolve(from, item.name), join(to, item.name), process.platform === 'win32' ? 'junction' : 'dir');
    }
  }
  const profileName = 'univer-workspace-harness';
  const profile = join(staging, 'profiles', profileName);
  const shipped = join(source, 'home', 'profiles', profileName);
  await mkdir(profile, { recursive: true });
  for (const item of await readdir(shipped, { withFileTypes: true })) {
    if (item.isFile() && !item.name.startsWith('.')) await cp(join(shipped, item.name), join(profile, item.name));
  }
  await linkPackages(join(shipped, 'node_modules'), join(profile, 'node_modules'));
  await symlink(resolve(source, 'home/internal-packages'), join(staging, 'internal-packages'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(staging, '.desktop-complete'), identity);
  // Preserve the previous profile, including edits. Never delete an old full
  // runtime on the startup path. The stable home path keeps account links valid.
  const previous = `${target}.previous-${Date.now()}`;
  let backedUp = false;
  try {
    await rename(target, previous);
    backedUp = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await rename(staging, target);
  } catch (error) {
    if (backedUp) await rename(previous, target);
    throw error;
  }
  return target;
}
module.exports = { prepareRuntimeHome };
