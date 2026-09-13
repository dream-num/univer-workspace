// Test-only preload inherited through the launcher by the published DSH host.
// Capture initialization up to its ready IPC message, before Windows taskkill.
const { Session } = require('node:inspector');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
if (process.env.UWA_SMOKE_PROFILE_DIR &&
    process.argv[1]?.replaceAll('\\', '/').endsWith('/@deepseek-ai/dsh/lib/bin.js')) {
  const session = new Session();
  session.connect();
  session.post('Profiler.enable');
  session.post('Profiler.start');
  const send = process.send;
  let stopped = false;
  process.send = function (message, ...args) {
    if (!stopped && message?.type === 'uwh-desktop-ready') {
      stopped = true;
      session.post('Profiler.stop', (error, result) => {
        if (error) throw error;
        mkdirSync(process.env.UWA_SMOKE_PROFILE_DIR, { recursive: true });
        writeFileSync(join(process.env.UWA_SMOKE_PROFILE_DIR, 'backend.cpuprofile'), JSON.stringify(result.profile));
        session.disconnect();
      });
    }
    return send.call(this, message, ...args);
  };
}
