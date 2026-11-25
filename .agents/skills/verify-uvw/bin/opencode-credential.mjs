#!/usr/bin/env node
// The model credential an opencode story or MO1 takes from the developer's own opencode.
// opencode-credential.mjs <run> <model>   prints the run's export for the model's integration, or nothing when none is stored
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentialSecrets } from './secrets.mjs';

// Providers whose credential opencode stores under another integration.
const INTEGRATIONS = [[/^console-/, 'opencode']];

export function modelIntegration(model, override) {
  if (override) return override;
  const provider = model.split('/')[0];
  return INTEGRATIONS.find(([pattern]) => pattern.test(provider))?.[1] ?? provider;
}

const holdsSecret = path => { try { return credentialSecrets(JSON.parse(readFileSync(path, 'utf8'))).length > 0; } catch { return false; } };

/** The integration's stored credential, exported once per run into `home/`; undefined when opencode stores none. */
export function exportCredential(run, integration) {
  if (!/^[A-Za-z0-9._-]+$/.test(integration)) throw new Error(`invalid opencode integration ${JSON.stringify(integration)}`);
  const credential = join(run, 'home', `opencode-credential-${integration}.json`);
  // An export cut short leaves a file without a secret, so only a complete one is reused.
  if (existsSync(credential) && holdsSecret(credential)) return credential;
  const file = openSync(credential, 'w', 0o600);
  const exported = spawnSync('opencode', ['auth', 'export', integration, '--standalone'], { stdio: ['ignore', file, 'ignore'] });
  closeSync(file);
  if (exported.status === 0 && holdsSecret(credential)) return credential;
  rmSync(credential);
}

function storedIntegrations() {
  const listed = spawnSync('opencode', ['auth', 'list', '--standalone', '--format', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try { return JSON.parse(listed.stdout).filter(({ connections = [] }) => connections.some(({ type }) => type === 'credential')).map(({ id }) => id); } catch { return []; }
}

/**
 * A story's model credential: the run's export for the model's integration, or else only the shell variables
 * VERIFY_UVW_STORY_ENV names. Their values go to `home/story-env.json` so the redactor finds them.
 */
export function storyCredential(run, model, env = process.env) {
  const integration = modelIntegration(model, env.VERIFY_UVW_OPENCODE_CREDENTIAL);
  const file = exportCredential(run, integration);
  if (file) return { integration, file };
  const names = (env.VERIFY_UVW_STORY_ENV ?? '').split(/[\s,]+/).filter(Boolean);
  const unset = names.filter(name => !env[name]);
  if (!names.length || unset.length) {
    throw new Error(`${model} has no model credential: opencode stores none for integration ${integration} (stored: ${storedIntegrations().join(', ') || 'none'})${unset.length ? `, and your shell does not set ${unset.join(', ')}` : ''}. Set VERIFY_UVW_OPENCODE_CREDENTIAL=<integration> to use a stored one, or VERIFY_UVW_STORY_ENV=<names> to pass those shell variables, such as DEEPSEEK_API_KEY`);
  }
  const vars = Object.fromEntries(names.map(name => [name, env[name]]));
  const recorded = join(run, 'home/story-env.json');
  let earlier = {};
  try { earlier = JSON.parse(readFileSync(recorded, 'utf8')); } catch {}
  writeFileSync(recorded, JSON.stringify({ ...earlier, ...vars }), { mode: 0o600 });
  return { integration, vars };
}

// The helper reaches this file through /tmp, which macOS resolves to /private/tmp.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [run, model] = process.argv.slice(2);
  if (!run || !model) {
    console.error('Usage: opencode-credential.mjs <run> <model>');
    process.exitCode = 2;
  } else {
    try { console.log(exportCredential(run, modelIntegration(model, process.env.VERIFY_UVW_OPENCODE_CREDENTIAL)) ?? ''); }
    catch (error) { console.error(`verify-uvw: ${error.message}`); process.exitCode = 1; }
  }
}
