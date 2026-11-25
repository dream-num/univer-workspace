#!/usr/bin/env node
// The one place that keeps secrets out of evidence.
// secrets.mjs redact|redact-sign-in <run> < text > redacted      secrets.mjs check <run> <directory>
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

// A claim link's code: 16 random bytes in base64url (agent-claims.ts in the server). `redact` keeps it, because a
// recipe opens the link from the evidence that holds it; `check` flags it and prints CLAIM_FIX for after the claim.
const CLAIM = /\/claim\/[A-Za-z0-9_-]{22}(?![A-Za-z0-9_-])/;
const CLAIM_FIX = `perl -pi -e 's{${CLAIM.source}}{/claim/${MARK}}g'`;

export function redact(text, literals = []) {
  for (const literal of literals) if (literal) text = text.split(literal).join(MARK);
  for (const [, pattern] of PATTERNS) text = text.replace(pattern, (_, keep) => (typeof keep === 'string' ? keep : '') + MARK);
  return text;
}

// A client's OAuth sign-in transcript also carries the authorization code, its state and challenge, and
// the code the client's own tools echo. Other evidence keeps `code` and `state` readable (error codes,
// Issue states), so only sign-in transcripts get these.
const SIGN_IN = [
  [/([?&](?:code|state|code_challenge)=)[^\s"'<>\\&#]+/gi, `$1${MARK}`],
  [/("(?:code|state|code_challenge)"\s*:\s*")(?:\\.|[^"\\\r\n])*(")/gi, `$1${MARK}$2`],
];

/** `redact` for a sign-in transcript: terminal colours removed and the OAuth flow values hidden too. */
export function redactSignIn(text, literals = []) {
  text = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  for (const [pattern, replacement] of SIGN_IN) text = text.replace(pattern, replacement);
  return redact(text, literals);
}

/** Names what `redact` would still change, never the secret itself. */
export function findSecrets(text, literals = []) {
  return [
    ...(literals.some(literal => literal && text.includes(literal)) ? ['a secret of this run'] : []),
    ...PATTERNS.filter(([, pattern]) => new RegExp(pattern.source, pattern.flags.replace('g', '')).test(text)).map(([name]) => name),
    ...(CLAIM.test(text) ? ['claim code'] : []),
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
  const values = path => { try { return Object.values(JSON.parse(read(path))); } catch { return []; } };
  const home = join(run, 'home');
  // uvw keeps its session cookie here, for the run's user and for every story identity.
  const univerHomes = [home, ...names(join(home, 'stories')).map(name => join(home, 'stories', name, '.univer-workspace-cli'))];
  return [
    read(join(run, 'user.pw')),
    ...['mcp-session', 'mcp-token', 'mcp-oauth-access', 'mcp-oauth-refresh', 'mcp-oauth-refresh-previous', 'mcp-oauth-secret', 'metrics-token', 'workspace-metrics-token', 'executor-token', 'renderer-token']
      .map(name => read(join(home, name))),
    ...names(join(home, 'principals')).filter(name => name.endsWith('.token')).map(name => read(join(home, 'principals', name))),
    ...names(home).filter(name => /^opencode-credential-.+\.json$/.test(name)).flatMap(name => json(join(home, name))),
    // Every shell variable a story was given, whatever its name.
    ...values(join(home, 'story-env.json')),
    ...json(join(home, 'codex-credential.json')),
    ...names(join(home, 'stories')).flatMap(name => json(join(home, 'stories', name, '.codex/auth.json'))),
    ...univerHomes.flatMap(directory => json(join(directory, 'distributions/univer-workspace-cli/workspace-cli/session.json'))),
  ].filter(Boolean);
}

// The helper reaches this file through /tmp, which macOS resolves to /private/tmp.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, run, directory] = process.argv.slice(2);
  if ((command === 'redact' || command === 'redact-sign-in') && run) {
    process.stdout.write((command === 'redact' ? redact : redactSignIn)(readFileSync(0, 'utf8'), runSecrets(run)));
  } else if (command === 'check' && directory && existsSync(directory)) {
    const literals = runSecrets(run);
    const paths = readdirSync(directory, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
    const found = paths.flatMap(path => findSecrets(readFileSync(path, 'latin1'), literals).map(name => ({ path, line: `FAIL  ${relative(directory, path)}: ${name}` })));
    const claims = found.filter(({ line }) => line.endsWith(': claim code')).map(({ path }) => `'${path.replaceAll("'", "'\\''")}'`);
    console.log(found.length ? found.map(({ line }) => line).join('\n') : `ok    no token, session cookie or run secret in ${paths.length} files under ${directory}`);
    if (claims.length) console.log(`Once the claim link has been used, redact its code with:\n  ${CLAIM_FIX} ${claims.join(' ')}`);
    process.exitCode = found.length ? 1 : 0;
  } else {
    console.error('Usage: secrets.mjs redact|redact-sign-in <run> < text\n       secrets.mjs check <run> <directory>');
    process.exitCode = 2;
  }
}
