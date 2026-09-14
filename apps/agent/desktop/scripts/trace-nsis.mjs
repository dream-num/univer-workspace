import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);

// Version-scoped diagnostic adapter for published builder templates. Modify a
// generated copy only; refuse changed anchors when upgrading electron-builder.
export async function prepareTracedNsis(desktop) {
  const metadata = createRequire(require.resolve('electron-builder/package.json')).resolve('app-builder-lib/package.json');
  const pkg = JSON.parse(await readFile(metadata, 'utf8'));
  if (pkg.version !== '26.15.3') throw new Error('Re-audit NSIS trace anchors for the new builder version');
  const output = join(desktop, '.build/nsis-trace');
  await mkdir(output, { recursive: true });
  await cp(join(dirname(metadata), 'templates/nsis'), output, { recursive: true });
  const entry = join(output, 'installer.nsi');
  await writeFile(entry, `!cd "${output}"\n` + await readFile(entry, 'utf8'));
  const insert = (phase, statement) => `!insertmacro agentInstallTrace "${phase}-start"\n${statement}\n!insertmacro agentInstallTrace "${phase}-complete"`;
  const files = {
    'installSection.nsh': [
      ['old-uninstaller', '!insertmacro uninstallOldVersion SHELL_CONTEXT'],
      ['payload', '!insertmacro installApplicationFiles'],
      ['registry', '!insertmacro registryAddInstallInfo'],
      ['start-menu', '!insertmacro addStartMenuLink $keepShortcuts'],
      ['desktop-shortcut', '!insertmacro addDesktopLink $keepShortcuts'],
    ],
    'include/installer.nsh': [
      ['extract', '!insertmacro extractEmbeddedAppPackage'],
      ['cache-installer', '!insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\\${APP_INSTALLER_STORE_FILE}"'],
    ],
  };
  for (const [name, anchors] of Object.entries(files)) {
    const path = join(output, name);
    let source = await readFile(path, 'utf8');
    for (const [phase, anchor] of anchors) {
      if (source.split(anchor).length !== 2) throw new Error(`NSIS trace anchor changed: ${name}: ${phase}`);
      source = source.replace(anchor, insert(phase, anchor));
    }
    await writeFile(path, source);
    // Local includes take precedence over builder's unchanged -I directory.
    if (name.startsWith('include/')) await writeFile(join(output, name.slice(8)), source);
  }
}
