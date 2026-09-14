// Native DMG installation/replacement probe in an isolated CI directory.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rename, rm, writeFile, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifyRuntime } from '../src/runtime.cjs';
const exec = promisify(execFile);
export async function installMac(dmg, destination, reportPath) {
  if (process.platform !== 'darwin') throw new Error('DMG acceptance requires native macOS');
  const scratch = await mkdtemp(join(tmpdir(), 'uwa-dmg-'));
  const mount = join(scratch, 'mount');
  const staged = `${destination}.staged`;
  const backup = `${destination}.previous`;
  const phases = [];
  const started = performance.now();
  let mounted = false, moved = false, activated = false;
  const phase = async (name, action) => {
    const at = performance.now();
    try { await action(); }
    finally { phases.push({ phase: name, elapsedMs: Math.round(performance.now() - started), durationMs: Math.round(performance.now() - at) }); }
  };
  const report = { budgetMs: 60000, phases, success: false };
  try {
    await mkdir(dirname(destination), { recursive: true });
    // Refuse to overwrite evidence left by an interrupted installation.
    for (const path of [staged, backup]) {
      try { await stat(path); throw new Error(`Recovery required before replacing ${path}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await phase('mount', async () => {
      await exec('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mount], { timeout: 120000 }); mounted = true;
    });
    await phase('copy', () => exec('ditto', [join(mount, 'Univer Workspace Agent.app'), staged], { timeout: 180000 }));
    await phase('verify-runtime', () => verifyRuntime(join(staged, 'Contents/Resources/runtime')));
    await phase('activate', async () => {
      try { await rename(destination, backup); moved = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await rename(staged, destination); activated = true; }
      catch (error) { if (moved) { await rename(backup, destination); moved = false; } throw error; }
    });
    report.success = true;
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    try {
      if (mounted) await phase('detach', async () => {
        await exec('hdiutil', ['detach', mount], { timeout: 60000 }); mounted = false;
      });
    } catch (error) {
      report.success = false;
      report.detachError = error.message;
      throw error;
    }
    finally {
      report.elapsedMs = Math.round(performance.now() - started);
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      if (!mounted) await rm(scratch, { recursive: true, force: true });
      if (!activated) await rm(staged, { recursive: true, force: true });
    }
  }
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await installMac(...process.argv.slice(2));
}
