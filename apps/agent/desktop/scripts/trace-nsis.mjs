import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);

// Version-scoped installer lifecycle/diagnostic adapter for published builder templates. Modify a
// generated copy only; refuse changed anchors when upgrading electron-builder.
export async function prepareTracedNsis(desktop) {
  const metadata = createRequire(require.resolve('electron-builder/package.json')).resolve('app-builder-lib/package.json');
  const pkg = JSON.parse(await readFile(metadata, 'utf8'));
  if (pkg.version !== '26.15.3') throw new Error('Re-audit NSIS trace anchors for the new builder version');
  const output = join(desktop, '.build/nsis-trace');
  await mkdir(output, { recursive: true });
  await cp(join(dirname(metadata), 'templates/nsis'), output, { recursive: true });
  // Keep builder's default script entry: a custom nsis.script bypasses its
  // separate uninstaller generation/signing pass. Only redirect relative
  // includes to the generated template copy in both normal builder passes.
  await writeFile(join(output, 'agent-trace.nsh'),
    `!cd "${output}"\n!include "${join(desktop, 'installer/agent.nsh')}"\n`);
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
      source = source.replace(anchor, insert(phase, anchor) + (phase === 'payload'
        ? '\n!insertmacro agentPrepareUserData' : ''));
    }
    await writeFile(path, source);
    // Local includes take precedence over builder's unchanged -I directory.
    if (name.startsWith('include/')) await writeFile(join(output, name.slice(8)), source);
  }
  // Bypass only the known broken alpha.3 uninstaller when replacing in place.
  // Keep other versions and installation-location changes on builder's path.
  const utility = join(output, 'include/installUtil.nsh');
  let utilitySource = await readFile(utility, 'utf8');
  const legacyAnchor = '  ${if} $installMode == "CurrentUser"';
  if (utilitySource.split(legacyAnchor).length !== 2) throw new Error('Re-audit the legacy uninstaller migration anchor');
  utilitySource = utilitySource.replace(legacyAnchor,
    '  !insertmacro readReg $R5 "$rootKey" "${UNINSTALL_REGISTRY_KEY}" DisplayVersion\n' +
    '  !insertmacro agentMigrateAlpha3 "$R5" "$installationDir"\n\n' + legacyAnchor);
  await writeFile(utility, utilitySource);
  await writeFile(join(output, 'installUtil.nsh'), utilitySource);
  // The published ZIP failure path uses Quit, which bypasses .onInstFailed.
  // Route an actual extraction error through the same rollback entry as the
  // native failure fixture; silent updates must not wait on an invisible modal.
  const extraction = join(output, 'include/extractAppPackage.nsh');
  const failure = '      MessageBox MB_OK|MB_ICONEXCLAMATION "$(decompressionFailed)$\\n$R0"\n      Quit';
  let source = await readFile(extraction, 'utf8');
  if (source.split(failure).length !== 2) throw new Error('Re-audit the NSIS ZIP failure path');
  source = source.replace(failure,
    '      MessageBox MB_OK|MB_ICONEXCLAMATION "$(decompressionFailed)$\\n$R0" /SD IDOK\n      !insertmacro agentExtractionFailed');
  // The success branch skips two NSIS instructions in the original template.
  // The failure macro expands to more instructions, so use a label instead.
  const success = '    StrCmp $R0 "success" +3';
  if (source.split(success).length !== 2) throw new Error('Re-audit the NSIS ZIP success branch');
  source = source.replace(success, '    StrCmp $R0 "success" uwa_zip_complete')
    .replace('      !insertmacro agentExtractionFailed', '      !insertmacro agentExtractionFailed\n    uwa_zip_complete:');
  await writeFile(extraction, source);
  await writeFile(join(output, 'extractAppPackage.nsh'), source);
}
