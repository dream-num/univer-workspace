const { readFile, rm } = require('node:fs/promises');
const { dirname, resolve, join } = require('node:path');
const { verifyRuntime } = require('./runtime.cjs');

// Called after the new UI has loaded. Preserve the old tree if verification or
// cleanup fails; never remove an unmarked directory with a similar filename.
async function retirePreviousInstallation(executable, resources, report) {
  const installation = dirname(executable);
  const backup = `${installation}.uwa-previous`;
  let owner;
  try { owner = await readFile(join(backup, '.uwa-backup-owner'), 'utf16le');
    owner = owner.replace(/^\uFEFF/, ''); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (resolve(owner) !== resolve(installation)) throw new Error('Unexpected previous installation owner');
  report({ phase: 'update-verify-start' });
  await verifyRuntime(resources);
  report({ phase: 'update-verify-complete' });
  report({ phase: 'update-cleanup-start' });
  await rm(backup, { recursive: true, maxRetries: 5, retryDelay: 200 });
  report({ phase: 'update-cleanup-complete' });
}
module.exports = { retirePreviousInstallation };
