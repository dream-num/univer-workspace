import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { cp, mkdir, rm, writeFile, readFile, access, readdir, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { Readable } from 'node:stream';

// Preserve the two published dependency graphs: profile packages resolve their
// own versions first, then the bootstrap graph at the archive root.
export async function packDesktopHost(desktop, runtime) {
  const stage = join(desktop, '.build/host-stage');
  await mkdir(stage);
  try {
    await cp(join(runtime, 'bootstrap'), stage, { recursive: true, dereference: true });
    await cp(join(runtime, 'home/profiles/univer-workspace-harness'), join(stage, 'profile'),
      { recursive: true, dereference: true });
    // DSH request extensions discover manifests independently of import hooks.
    // Record profile-only bundles as virtual ASAR links to their owning package.
    // Use the public stream API: OS junctions become absolute on Windows, which
    // ASAR 3's directory crawler misinterprets, and real symlinks need privileges.
    const links = [];
    const profileRoot = join(stage, 'profile');
    const profile = JSON.parse(await readFile(join(profileRoot, 'package.json'), 'utf8'));
    for (const name of profile.dsh?.profile?.bundles ?? []) {
      const link = join(stage, 'node_modules', name);
      try { await access(link); continue; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const target = join(profileRoot, 'node_modules', name);
      await access(join(target, 'package.json'));
      await mkdir(dirname(link), { recursive: true });
      links.push({ type: 'link', path: relative(stage, link),
        symlink: relative(dirname(link), target), stat: await stat(target),
        unpacked: false, streamGenerator: () => Readable.from([]) });
    }
    await writeFile(join(stage, 'desktop.cordis.yml'), '[]\n');
    const streams = [];
    async function collect(directory, parentUnpacked = false) {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const entry of entries) {
        const source = join(directory, entry.name);
        const path = relative(stage, source);
        const unpacked = parentUnpacked || entry.name === 'node-pty';
        if (entry.isDirectory()) {
          streams.push({ type: 'directory', path, unpacked });
          await collect(source, unpacked);
        } else if (entry.isFile()) {
          streams.push({ type: 'file', path, stat: await stat(source),
            unpacked: unpacked || /\.(?:node|exe|dll|so(?:\..+)?|dylib)$/.test(entry.name) || entry.name === 'spawn-helper',
            streamGenerator: () => createReadStream(source) });
        } else throw new Error(`Unsupported staged runtime entry: ${path}`);
      }
    }
    await collect(stage);
    const require = createRequire(import.meta.url);
    const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
    await builderRequire('@electron/asar').createPackageFromStreams(join(runtime, 'host.asar'), [...streams, ...links]);
    await cp(join(desktop, 'src/dsh-host.cjs'), join(runtime, 'dsh-host.cjs'));
    await rm(join(runtime, 'bootstrap'), { recursive: true });
    await rm(join(runtime, 'home/profiles/univer-workspace-harness/node_modules'), { recursive: true });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
