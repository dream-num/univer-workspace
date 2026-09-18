import { installMac } from './install-mac.mjs';
import { _electron } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
const exec = promisify(execFile);
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const extracted = resolve(process.argv[2]);
const appRoot = await mkdtemp(join(homedir(), 'uwa-protocol-'));
const systemRoot = await mkdtemp(join(tmpdir(), 'uwa-system-protocol-'));
const dmgRoot = await mkdtemp(join(tmpdir(), 'uwa-dmg-protocol-'));
for (const [name, root] of [['system-temp', join(systemRoot, 'Univer Workspace Agent.app')], ['dmg', join(dmgRoot, 'Univer Workspace Agent.app')], ['runner-temp', extracted], ['home', join(appRoot, 'Univer Workspace Agent.app')]]) {
  if (name === 'dmg') await installMac(resolve(process.argv[3]), root, join(dmgRoot, 'install.json'));
  else if (root !== extracted) await exec('ditto', [extracted, root]);
  console.log(name, root);
  const plist = await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleURLTypes', join(root, 'Contents/Info.plist')]);
  console.log('URL types:', plist.stdout);
  const registered = name === 'dmg' ? { note: 'already registered by installMac before DMG detach' } : await exec(lsregister, ['-f', root]);
  console.log('lsregister:', registered);
  const profile = await mkdtemp(join(tmpdir(), 'uwa-protocol-user-'));
  const app = await _electron.launch({ executablePath: join(root, 'Contents/MacOS/Univer Workspace Agent'),
    args: [`--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await page.waitForURL(url => url.origin === 'http://127.0.0.1:3101', { timeout: 60000 });
    for (const delay of [0, 5000, 'register-after-launch']) {
      if (delay === 'register-after-launch') console.log('re-register live bundle', await exec(lsregister, ['-f', root]));
      else if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      console.log(await app.evaluate(async ({ app }) => {
        const scheme = 'univer-workspace';
        const before = app.isDefaultProtocolClient(scheme);
        const set = app.setAsDefaultProtocolClient(scheme);
        let handler;
        try { const info = await app.getApplicationInfoForProtocol(`${scheme}://login`); handler = { name: info.name, path: info.path }; }
        catch (error) { handler = error.message; }
        return { before, set, after: app.isDefaultProtocolClient(scheme), handler, executable: process.execPath };
      }));
    }
  } finally { await app.close(); await exec(lsregister, ['-u', root]); }
}
