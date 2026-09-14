const { access, readFile, rm, writeFile } = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { dirname, resolve, join } = require('node:path');
const { verifyRuntime } = require('./runtime.cjs');
const execute = promisify(execFile);

async function readOwner(path) {
  try { return (await readFile(path, 'utf16le')).replace(/^\uFEFF/, ''); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
}

// Called after the new UI has loaded. Preserve the old tree if verification or
// cleanup fails; never remove an unmarked directory with a similar filename.
async function retirePreviousInstallation(executable, resources, report) {
  const installation = dirname(executable);
  const backup = `${installation}.uwa-previous`;
  // Keep ownership outside the tree being deleted so an interrupted cleanup
  // can resume even after the internal marker has already been removed.
  const cleanupOwner = `${backup}.owner`;
  const owners = [await readOwner(join(backup, '.uwa-backup-owner')), await readOwner(cleanupOwner)].filter(owner => owner !== undefined);
  if (!owners.length) return;
  if (owners.some(owner => resolve(owner) !== resolve(installation))) throw new Error('Unexpected previous installation owner');
  report({ phase: 'update-verify-start' });
  await verifyRuntime(resources);
  report({ phase: 'update-verify-complete' });
  try { await writeFile(cleanupOwner, Buffer.from('\uFEFF' + installation, 'utf16le'), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST' || resolve(await readOwner(cleanupOwner)) !== resolve(installation)) throw error;
  }
  report({ phase: 'update-cleanup-start' });
  if (process.platform === 'win32') {
    // Node's recursive rm did not finish this installed tree within 120 seconds
    // in native CI. Use the Windows directory remover outside Electron's FS
    // work queue. Pass the path as quoted environment data, never command text.
    let exists = true;
    try { await access(backup); }
    catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
    if (exists) await execute(join(process.env.SystemRoot, 'System32/cmd.exe'),
      ['/d', '/v:off', '/s', '/c', 'rmdir /s /q "%UWA_RETIRE_DIRECTORY%"'], {
        env: { ...process.env, UWA_RETIRE_DIRECTORY: backup },
        windowsHide: true, windowsVerbatimArguments: true, timeout: 120000,
      });
  } else {
    await rm(backup, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  let remains = true;
  try { await access(backup); }
  catch (error) { if (error.code === 'ENOENT') remains = false; else throw error; }
  if (remains) throw new Error('Previous installation cleanup left files behind');
  await rm(cleanupOwner);
  report({ phase: 'update-cleanup-complete' });
}
module.exports = { retirePreviousInstallation };
