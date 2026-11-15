#!/usr/bin/env node
// The one place that keeps secrets out of evidence.
// secrets.mjs redact <run> < text > redacted      secrets.mjs check <run> <directory>
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARK = '[REDACTED]';
// Group 1, where present, is kept. A value that starts with [ or < is already a placeholder or a token shape.
const PATTERNS = [
  ['Workspace token', /uvw_(?:at|rt|pat)_[A-Za-z0-9._~-]+/g],
  ['session cookie', /(workspace_session=)(?![[<])[^;,\s"'\\&]+/g],
  // `Bearer name="..."` is a WWW-Authenticate challenge, not a credential.
  ['bearer credential', /(Bearer\s+)(?![a-z_]+=)[A-Za-z0-9._~+/=-]{16,}/gi],
  ['OAuth token field', /((?:access_token|refresh_token|id_token|client_secret|code_verifier)\\*"\s*:\s*\\*")(?![[<])[^"\\]{8,}/gi],
  ['OAuth token parameter', /([?&](?:access_token|refresh_token|id_token|client_secret|code_verifier)=)(?![[<])[^\s"'<>\\&#]+/gi],
];

export function redact(text, literals = []) {
  for (const literal of literals) if (literal) text = text.split(literal).join(MARK);
  for (const [, pattern] of PATTERNS) text = text.replace(pattern, (_, keep) => (typeof keep === 'string' ? keep : '') + MARK);
  return text;
}

/** Names what `redact` would still change, never the secret itself. */
export function findSecrets(text, literals = []) {
  return [
    ...(literals.some(literal => literal && text.includes(literal)) ? ['a secret of this run'] : []),
    ...PATTERNS.filter(([, pattern]) => new RegExp(pattern.source, pattern.flags.replace('g', '')).test(text)).map(([name]) => name),
  ];
}

/** Secret values in a stored credential document: opencode's exported model credential or a uvw session file. */
export function credentialSecrets(value, key = '') {
  if (typeof value === 'string') return /access|refresh|secret|password|token|session|cookie|key|email/i.test(key) && value.length >= 8 ? [value] : [];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([name, child]) => credentialSecrets(child, Array.isArray(value) ? key : name));
}

/** Every secret value this run holds; empty once `down` has removed them. */
export function runSecrets(run) {
  const read = path => existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
  const names = directory => existsSync(directory) ? readdirSync(directory) : [];
  const json = path => { try { return credentialSecrets(JSON.parse(read(path))); } catch { return []; } };
  const home = join(run, 'home');
  // uvw keeps its session cookie here, for the run's user and for every story identity.
  const univerHomes = [home, ...names(join(home, 'stories')).map(name => join(home, 'stories', name, '.univer-workspace-cli'))];
  return [
    read(join(run, 'user.pw')),
    ...['mcp-session', 'mcp-token', 'mcp-oauth-access', 'mcp-oauth-refresh', 'mcp-oauth-refresh-previous', 'mcp-oauth-secret', 'metrics-token', 'executor-token', 'renderer-token']
      .map(name => read(join(home, name))),
    ...names(join(home, 'principals')).filter(name => name.endsWith('.token')).map(name => read(join(home, 'principals', name))),
    ...json(join(home, 'opencode-credential.json')),
    ...univerHomes.flatMap(directory => json(join(directory, 'distributions/univer-workspace-cli/workspace-cli/session.json'))),
  ].filter(Boolean);
}

// The helper reaches this file through /tmp, which macOS resolves to /private/tmp.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, run, directory] = process.argv.slice(2);
  if (command === 'redact' && run) {
    process.stdout.write(redact(readFileSync(0, 'utf8'), runSecrets(run)));
  } else if (command === 'check' && directory && existsSync(directory)) {
    const literals = runSecrets(run);
    const paths = readdirSync(directory, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
    const found = paths.flatMap(path => findSecrets(readFileSync(path, 'latin1'), literals).map(name => `FAIL  ${relative(directory, path)}: ${name}`));
    console.log(found.length ? found.join('\n') : `ok    no token, session cookie or run secret in ${paths.length} files under ${directory}`);
    process.exitCode = found.length ? 1 : 0;
  } else {
    console.error('Usage: secrets.mjs redact <run> < text\n       secrets.mjs check <run> <directory>');
    process.exitCode = 2;
  }
}
