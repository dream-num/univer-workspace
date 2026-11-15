#!/usr/bin/env node
// Prints the container engine `docker info` reports. Exits 0 only for the engines MCP mode is verified on.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const supportedEngine = (platform, engine) => platform === 'darwin' && ['Docker Desktop', 'OrbStack'].includes(engine);

// The helper reaches this file through /tmp, which macOS resolves to /private/tmp.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let engine = '';
  try {
    engine = execFileSync('docker', ['info', '--format', '{{.OperatingSystem}}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000, maxBuffer: 1 << 20 }).trim();
  } catch {}
  console.log(engine || 'no running engine');
  // exitCode, not exit(): a pipe on macOS is written asynchronously and exit() can drop the line.
  process.exitCode = supportedEngine(process.platform, engine) ? 0 : 1;
}
