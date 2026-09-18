import { _electron } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
const exec = promisify(execFile);
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const extracted = resolve(process.argv[2]);
const appRoot = await mkdtemp(join(homedir(), 'Applications/uwa-protocol-').replace('/Applications/uwa-', '/uwa-'));
for (const [name, root] of [['temporary', extracted], ['home', join(appRoot, 'Univer Workspace Agent.app')]]) {
  if (name === 'home') { await mkdir(appRoot, { recursive: true }); await exec('ditto', [extracted, root]); }
  console.log(name, root);
  const plist = await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleURLTypes', join(root, 'Contents/Info.plist')]);
  console.log('URL types:', plist.stdout);
  const registered = await exec(lsregister, ['-f', root]);
  console.log('lsregister:', registered);
  const profile = await mkdtemp(join(tmpdir(), 'uwa-protocol-user-'));
  const app = await _electron.launch({ executablePath: join(root, 'Contents/MacOS/Univer Workspace Agent'),
    args: [`--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await page.waitForURL(url => url.origin === 'http://127.0.0.1:3101', { timeout: 60000 });
    for (const delay of [0, 5000]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
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
  } finally { await app.close(); }
}
const dump = await exec(lsregister, ['-dump'], { maxBuffer: 10 * 1024 * 1024 });
console.log(dump.stdout.split(/\n-+\n/).filter(block => block.includes('org.univer.workspace.agent')).join('\n').slice(0, 20000));
