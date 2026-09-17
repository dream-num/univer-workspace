const fs = require('node:fs');
const promises = require('node:fs/promises');
const { syncBuiltinESMExports } = require('node:module');

// Electron 44 fabricates number Stats for ASAR even with { bigint: true }.
// DSH correctly expects BigIntStats (notably mode & 511n). Repair only that
// violated host contract, without changing DSH or physical-file metadata.
// Remove when Electron's ASAR stat/lstat implementations honor bigint.
function installAsarStatsCompatibility() {
  if (!process.versions.electron?.startsWith('44.')) return () => {};
  const prototype = Object.getPrototypeOf(fs.statSync(__filename, { bigint: true }));
  const original = {};
  for (const name of ['stat', 'lstat']) {
    original[name] = promises[name];
    promises[name] = async function(path, options) {
      const info = await original[name].call(this, path, options);
      if (!options?.bigint || !info || typeof info.mode === 'bigint' ||
          !/\.asar(?:[/\\]|$)/i.test(String(path))) return info;
      const normalized = Object.assign(Object.create(prototype), info);
      for (const [key, value] of Object.entries(info)) {
        if (typeof value === 'number') normalized[key] = BigInt(Math.trunc(value));
      }
      for (const field of ['atime', 'mtime', 'ctime', 'birthtime']) {
        const ms = info[`${field}Ms`];
        normalized[`${field}Ns`] = BigInt(Math.trunc(ms)) * 1_000_000n
          + BigInt(Math.trunc((ms - Math.trunc(ms)) * 1_000_000));
      }
      return normalized;
    };
  }
  syncBuiltinESMExports();
  return () => {
    Object.assign(promises, original);
    syncBuiltinESMExports();
  };
}

module.exports = { installAsarStatsCompatibility };
