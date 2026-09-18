const { rm, writeFile } = require('node:fs/promises');
const { migrateRuntimeHome } = require('./run.cjs');

// The installer supplies a fresh private result path. Absence means unknown,
// never permission to restore old binaries. Clear a previous failed attempt's
// receipt before retrying, including before activation recovery can touch home.
async function prepareInstallerHome(resources, home, { receipt, ...options }) {
  await rm(receipt, { force: true });
  try {
    return await migrateRuntimeHome(resources, home, options);
  } catch (error) {
    if (error.runtimeHomeUnchanged) {
      try { await writeFile(receipt, 'unchanged', { flag: 'wx' }); }
      catch { /* Missing proof keeps both program trees; preserve the cause. */ }
    }
    throw error;
  }
}
module.exports = { prepareInstallerHome };
