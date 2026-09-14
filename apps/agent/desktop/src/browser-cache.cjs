const { cp, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

// Only disposable Chromium caches are replaced; cookies, settings and Agent
// account data keep their existing paths. Run before creating the first window.
async function prepareBrowserCache(runtime, userData, electronVersion) {
  const source = join(runtime, 'browser-cache-seed');
  let identity;
  try { identity = await readFile(join(source, 'manifest.json'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const manifest = JSON.parse(identity);
  if (manifest.format !== 1 || manifest.electron !== electronVersion)
    throw new Error('Desktop browser cache does not match its Electron version');
  const marker = join(userData, '.desktop-browser-cache');
  const code = join(userData, 'desktop-code-cache');
  try { if (await readFile(marker, 'utf8') === identity) return code; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staging = join(userData, '.browser-cache-staging');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await cp(join(source, 'Cache'), join(staging, 'Cache'), { recursive: true });
  await cp(join(source, 'code'), join(staging, 'code'), { recursive: true });
  for (const [name, target] of [['Cache', join(userData, 'Cache')], ['code', code]]) {
    let previous;
    try { previous = `${target}.previous-${Date.now()}`; await rename(target, previous); }
    catch (error) { if (error.code !== 'ENOENT') throw error; previous = undefined; }
    try { await rename(join(staging, name), target); }
    catch (error) { if (previous) await rename(previous, target); throw error; }
  }
  await writeFile(marker, identity);
  await rm(staging, { recursive: true, force: true });
  return code;
}
module.exports = { prepareBrowserCache };
