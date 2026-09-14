const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function probe() {
  process.env.ELECTRON_RUN_AS_NODE = '1';
  const archive = path.join(__dirname, 'host.asar');
  const script = path.join(__dirname, 'packaged-capability.mjs');
  process.argv = [process.execPath, script,
    path.join(archive, 'profile/node_modules/dsh-univer-workspace-plugin/lib')];
  // Existing acceptance exercises native Office CSV import/export and the
  // actual SDK worker fork/handshake, using a deliberately failing test runtime.
  await import(pathToFileURL(script).href);
  const pty = require(path.join(archive, 'node_modules/node-pty'));
  await new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    const terminal = pty.spawn(windows ? process.env.ComSpec : '/bin/sh',
      windows ? ['/d', '/c', 'echo uwa-asar-pty'] : ['-c', 'echo uwa-asar-pty'],
      { cols: 80, rows: 24, cwd: __dirname });
    let output = '';
    const timer = setTimeout(() => { terminal.kill(); reject(new Error('PTY timed out')); }, 10000);
    terminal.onData((data) => { output += data; });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      if (exitCode === 0 && output.includes('uwa-asar-pty')) resolve();
      else reject(new Error(`PTY output/exit mismatch: ${exitCode}`));
    });
  });
  process.parentPort.postMessage({ nativeOfficeRoundtrip: true, workerHandshake: true, terminal: true });
}

probe().catch((error) => process.parentPort.postMessage({ error: error.stack }));
