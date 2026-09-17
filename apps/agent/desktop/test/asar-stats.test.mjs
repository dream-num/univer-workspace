import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('ASAR compatibility returns BigIntStats without changing ordinary files or number stat requests', async () => {
  const path = fileURLToPath(import.meta.url);
  const numeric = await stat(path);
  const native = await stat(path, { bigint: true });
  const original = async (path, options) => path.includes('.asar') || !options?.bigint ? numeric : native;
  const promises = { stat: original, lstat: original };
  const module = { exports: {} };
  vm.runInNewContext(await readFile(new URL('../src/asar-stats.cjs', import.meta.url), 'utf8'), {
    module, __filename: path, process: { versions: { electron: '44.0.0' } },
    require(name) {
      if (name === 'node:fs') return { statSync: () => native };
      if (name === 'node:fs/promises') return promises;
      if (name === 'node:module') return { syncBuiltinESMExports() {} };
      throw new Error(name);
    },
  });
  const restore = module.exports.installAsarStatsCompatibility();
  for (const name of ['stat', 'lstat']) {
    const info = await promises[name]('C:\\runtime\\host.asar\\package.json', { bigint: true });
    assert.equal(info.mode & 511n, native.mode & 511n);
    assert.equal(info.isFile(), true);
    assert.equal(info.isDirectory(), false);
    assert.equal(typeof info.mtimeNs, 'bigint');
    assert.equal(info.size, native.size);
    assert.equal(await promises[name]('ordinary', { bigint: true }), native);
    assert.equal(await promises[name]('host.asar', {}), numeric);
  }
  restore();
  assert.equal(promises.stat, original);
  assert.equal(promises.lstat, original);
});
