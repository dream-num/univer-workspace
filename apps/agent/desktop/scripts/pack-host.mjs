import { createRequire } from 'node:module';
import { cp, mkdir, rm, writeFile, readFile, access, symlink } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';

// Preserve the two published dependency graphs: profile packages resolve their
// own versions first, then the bootstrap graph at the archive root.
export async function packDesktopHost(desktop, runtime) {
  const stage = join(desktop, '.build/host-stage');
  await mkdir(stage);
  try {
    await cp(join(runtime, 'bootstrap'), stage, { recursive: true, dereference: true });
    await cp(join(runtime, 'home/profiles/univer-workspace-harness'), join(stage, 'profile'),
      { recursive: true, dereference: true });
    // DSH request extensions discover active package manifests with filesystem
    // lookups, independently of the host import hook. Expose profile-only bundles
    // at the composition root as ASAR links to their real owning package. Existing
    // installation bundles keep priority and each dependency graph stays intact.
    const profileRoot = join(stage, 'profile');
    const profile = JSON.parse(await readFile(join(profileRoot, 'package.json'), 'utf8'));
    for (const name of profile.dsh?.profile?.bundles ?? []) {
      const link = join(stage, 'node_modules', name);
      try { await access(link); continue; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const target = join(profileRoot, 'node_modules', name);
      await access(join(target, 'package.json'));
      await mkdir(dirname(link), { recursive: true });
      // Junctions need no Windows developer-mode privilege; ASAR stores their
      // in-archive target, so the shipped link never retains this staging path.
      await symlink(process.platform === 'win32' ? target : relative(dirname(link), target),
        link, process.platform === 'win32' ? 'junction' : 'dir');
    }
    await writeFile(join(stage, 'desktop.cordis.yml'), '[]\n');
    const require = createRequire(import.meta.url);
    const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
    await builderRequire('@electron/asar').createPackageWithOptions(stage, join(runtime, 'host.asar'),
      { unpack: '{*.node,*.exe,*.dll,*.so,*.so.*,*.dylib,spawn-helper}', unpackDir: '**/node-pty' });
    await cp(join(desktop, 'src/dsh-host.cjs'), join(runtime, 'dsh-host.cjs'));
    await rm(join(runtime, 'bootstrap'), { recursive: true });
    await rm(join(runtime, 'home/profiles/univer-workspace-harness/node_modules'), { recursive: true });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
