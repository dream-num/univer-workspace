const { join, dirname } = require('node:path');
const { pathToFileURL } = require('node:url');

// Stable process results are shared by the installer and the application UI.
function migrationFailure(error) {
  let current = error;
  for (let depth = 0; current && depth < 12; depth++, current = current.cause) {
    const known = {
      DATA_VERSION_NEWER: { reason: 'newer', exitCode: 21, retryable: false },
      DATA_VERSION_INVALID: { reason: 'invalid', exitCode: 22, retryable: false },
      ENOSPC: { reason: 'space', exitCode: 23, retryable: true },
      EACCES: { reason: 'permission', exitCode: 24, retryable: true },
      EPERM: { reason: 'permission', exitCode: 24, retryable: true },
    }[current.code];
    if (known) return known;
  }
  return { reason: 'unknown', exitCode: 20, retryable: true };
}

function createDataUpgrade({ window, ipcMain, shell, log, home, locale, installer = false }) {
  const pageUrl = pathToFileURL(join(__dirname, 'data-upgrade.html')).href;
  let state = { phase: 'checking', locale, installer };
  let retry, closed = false;
  // A full disk can also prevent diagnostic writes. Keep the failure UI usable.
  const writeLog = event => { try { log.write(event); } catch {} };
  const channels = ['uwa:data-upgrade-state', 'uwa:data-upgrade-action'];
  const trusted = event => !closed && !window.webContents.isDestroyed()
    && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame.url === pageUrl;
  const report = event => {
    state = { locale, installer, ...event };
    writeLog({ ...event, phase: `data-${event.phase}` });
  };
  const dispose = () => {
    if (closed) return;
    closed = true;
    for (const channel of channels) ipcMain.removeHandler(channel);
    retry?.(false);
    retry = undefined;
  };
  window.once('closed', dispose);
  ipcMain.handle(channels[0], event => {
    if (!trusted(event)) throw new Error('Untrusted data upgrade caller');
    return state;
  });
  ipcMain.handle(channels[1], async (event, action) => {
    if (!trusted(event)) throw new Error('Untrusted data upgrade caller');
    if (action === 'logs') { shell.showItemInFolder(log.path); return; }
    if (action === 'backups') {
      const message = await shell.openPath(dirname(home));
      if (message) throw new Error('Unable to open backup directory');
      return;
    }
    if (state.phase !== 'failed') throw new Error('Data upgrade is running');
    if (action === 'exit') { window.close(); return; }
    if (action !== 'retry' || !state.retryable || !retry) throw new Error('Data upgrade action is unavailable');
    const resume = retry;
    retry = undefined;
    state = { phase: 'checking', locale, installer };
    resume(true);
  });
  return {
    report, dispose,
    async load() { await window.loadURL(pageUrl); window.show(); },
    async run(task) {
      while (!closed) {
        try { const result = await task(report); return closed ? undefined : result; }
        catch (error) {
          const failure = migrationFailure(error);
          writeLog({ phase: 'data-failed', error: error.message, stack: error.stack, code: failure.reason,
            cause: error.cause?.stack });
          const again = new Promise(resolve => { retry = resolve; });
          state = { phase: 'failed', locale, installer, ...failure };
          if (closed || !(await again)) return undefined;
        }
      }
      return undefined;
    },
  };
}

module.exports = { createDataUpgrade, migrationFailure };
