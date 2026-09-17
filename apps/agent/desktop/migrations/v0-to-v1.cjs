const { mkdir } = require('node:fs/promises');
const { join } = require('node:path');

// Version 0 is the pre-versioning Desktop layout. Version 1 adopts that layout
// without changing profile configuration or DSH-owned formats, and ensures the
// user preset root exists. Keep this transition while unversioned homes exist.
async function run({ staging }) {
  await mkdir(join(staging, '.agent-presets'), { recursive: true });
}

module.exports = { id: 'v0-to-v1', fromVersion: 0, toVersion: 1, run };
