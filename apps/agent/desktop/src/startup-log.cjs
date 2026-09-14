const { mkdirSync, appendFileSync, existsSync, renameSync, rmSync } = require('node:fs');
const { join } = require('node:path');
function createStartupLog(directory) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'startup.log');
  const previous = join(directory, 'startup.previous.log');
  if (existsSync(path)) {
    rmSync(previous, { force: true });
    renameSync(path, previous);
  }
  const start = Date.now();
  return { path, write(event) {
    appendFileSync(path, JSON.stringify({ time: new Date().toISOString(), elapsedMs: Date.now() - start, ...event }) + '\n');
  } };
}
module.exports = { createStartupLog };
