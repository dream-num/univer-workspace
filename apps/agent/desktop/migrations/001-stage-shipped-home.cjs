const { mkdir, readdir, cp, symlink, stat } = require('node:fs/promises');
const { join, resolve } = require('node:path');

async function run({ resources, staging }) {
  const profileName = 'univer-workspace-harness';
  const profile = join(staging, 'profiles', profileName);
  const shipped = join(resources, 'home', 'profiles', profileName);
  await mkdir(profile, { recursive: true });
  for (const item of await readdir(shipped, { withFileTypes: true })) {
    if (item.isFile() && !item.name.startsWith('.')) await cp(join(shipped, item.name), join(profile, item.name));
  }

  // Archived hosts resolve code directly. Older loose runtimes need individual
  // package links so DSH can add fallback links without writing to the install.
  const archived = await stat(join(resources, 'host.asar')).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  const links = [];
  async function collectPackages(from, to) {
    await mkdir(to, { recursive: true });
    for (const item of await readdir(from, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      if (item.name.startsWith('@')) await collectPackages(join(from, item.name), join(to, item.name));
      else links.push([resolve(from, item.name), join(to, item.name)]);
    }
  }
  if (!archived) await collectPackages(join(shipped, 'node_modules'), join(profile, 'node_modules'));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(16, links.length) }, async () => {
    while (next < links.length) {
      const [from, to] = links[next++];
      await symlink(from, to, process.platform === 'win32' ? 'junction' : 'dir');
    }
  }));
  await symlink(resolve(resources, 'home/internal-packages'), join(staging, 'internal-packages'),
    process.platform === 'win32' ? 'junction' : 'dir');
}

module.exports = { id: '001-stage-shipped-home', run };
