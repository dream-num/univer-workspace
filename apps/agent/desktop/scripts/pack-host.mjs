import { createRequire } from 'node:module';
import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

// Preserve the two published dependency graphs: profile packages resolve their
// own versions first, then the bootstrap graph at the archive root.
export async function packDesktopHost(desktop, runtime) {
  const stage = join(desktop, '.build/host-stage');
  await mkdir(stage);
  try {
    await cp(join(runtime, 'bootstrap'), stage, { recursive: true, dereference: true });
    await cp(join(runtime, 'home/profiles/univer-workspace-harness'), join(stage, 'profile'),
      { recursive: true, dereference: true });
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
