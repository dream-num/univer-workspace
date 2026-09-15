const { SCHEME } = require('./login.cjs');
const { mkdir, writeFile } = require('node:fs/promises');
const { join, isAbsolute } = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);

function desktopEntry(executable) {
  if (!isAbsolute(executable) || /[\r\n\0]/.test(executable)) throw new Error('Invalid application path');
  // Desktop Entry Exec has both string and command quoting layers; % is a field code.
  const quoted = executable.replaceAll('\\', '\\\\\\\\').replaceAll('"', '\\\\"')
    .replaceAll('`', '\\\\`').replaceAll('$', '\\\\$').replaceAll('%', '%%');
  return `[Desktop Entry]\nType=Application\nName=Univer Workspace Agent\nExec="${quoted}" %u\nTerminal=false\nNoDisplay=true\nMimeType=x-scheme-handler/${SCHEME};\n`;
}
async function registerLoginProtocol(app) {
  if (process.platform !== 'linux') {
    if (!app.isDefaultProtocolClient(SCHEME) && !app.setAsDefaultProtocolClient(SCHEME))
      throw new Error('Unable to register sign-in protocol');
    return;
  }
  // An AppImage's Electron executable lives in a temporary mount. Register the
  // original AppImage, and refresh on launch if the user moves the application.
  const executable = process.env.APPIMAGE || process.execPath;
  const root = process.env.XDG_DATA_HOME || join(app.getPath('home'), '.local', 'share');
  const applications = join(root, 'applications');
  const name = 'org.univer.workspace.agent.login.desktop';
  await mkdir(applications, { recursive: true });
  await writeFile(join(applications, name), desktopEntry(executable), { mode: 0o600 });
  await execFile('xdg-mime', ['default', name, `x-scheme-handler/${SCHEME}`], { timeout: 5000 });
}
module.exports = { registerLoginProtocol, desktopEntry };
