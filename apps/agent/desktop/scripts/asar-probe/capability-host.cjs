const { app, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData', path.join(__dirname, 'capability-electron-data'));
app.whenReady().then(() => {
  const child = utilityProcess.fork(path.join(__dirname, 'capabilities.cjs'), [], { stdio: 'pipe' });
  let diagnostics = '';
  let finished = false;
  const finish = (result) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    fs.writeFileSync(path.join(__dirname, 'capability-result.json'), JSON.stringify(result, null, 2));
    child.kill();
    app.exit(result.error ? 1 : 0);
  };
  const timer = setTimeout(() => finish({ error: 'Capability probe timed out', diagnostics }), 40000);
  child.stdout.on('data', () => {});
  child.stderr.on('data', (bytes) => { diagnostics = (diagnostics + bytes).slice(-8000); });
  child.on('message', finish);
  child.on('exit', (code) => { if (!finished) finish({ error: `Capability process exited: ${code}`, diagnostics }); });
});
