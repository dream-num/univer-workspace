const { cp, lstat } = require('node:fs/promises');
const { join } = require('node:path');

async function run({ home, staging }) {
  // Authored presets are user data, independent of the shipped profile version.
  try {
    await lstat(join(home, '.agent-presets'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  await cp(join(home, '.agent-presets'), join(staging, '.agent-presets'), { recursive: true });
}

module.exports = { id: '002-preserve-authored-presets', run };
