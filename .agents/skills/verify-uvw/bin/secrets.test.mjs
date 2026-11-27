import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { credentialSecrets, findSecrets, redact, redactSignIn, runSecrets } from './secrets.mjs';

const pat = 'uvw_pat_3fJk-9a.B_c~d', session = 'c2Vzc2lvbi1zZWNyZXQtdmFsdWU';

test('token, cookie, bearer and OAuth field shapes are redacted and nothing is left to find', () => {
  const cases = [
    [`token ${pat} end`, 'token [REDACTED] end', 'Workspace token'],
    ['uvw_at_abc and uvw_rt_def', '[REDACTED] and [REDACTED]', 'Workspace token'],
    [`Cookie: workspace_session=${session}; Path=/`, 'Cookie: workspace_session=[REDACTED]; Path=/', 'session cookie'],
    [`Set-Cookie: workspace_handoff=${session.slice(0, 22)}; Max-Age=604800; Path=/`, 'Set-Cookie: workspace_handoff=[REDACTED]; Max-Age=604800; Path=/', 'handoff cookie'],
    [`Authorization: Bearer ${session}`, 'Authorization: Bearer [REDACTED]', 'bearer credential'],
    [`{"access_token":"${session}","expires_in":600}`, '{"access_token":"[REDACTED]","expires_in":600}', 'OAuth token field'],
    [JSON.stringify({ output: `{"refresh_token": "${session}"}` }), JSON.stringify({ output: '{"refresh_token": "[REDACTED]"}' }), 'OAuth token field'],
    [`/callback?code_verifier=${session}&x=1`, '/callback?code_verifier=[REDACTED]&x=1', 'OAuth token parameter'],
  ];
  for (const [text, expected, name] of cases) {
    assert.deepEqual(findSecrets(text), [name], text);
    assert.equal(redact(text), expected);
    assert.deepEqual(findSecrets(redact(text)), []);
  }
});

test('challenges, placeholders, token shapes and ordinary tool arguments stay readable', () => {
  for (const text of [
    'WWW-Authenticate: Bearer resource_metadata="http://127.0.0.1:3930/.well-known/oauth-protected-resource/mcp"',
    'Authorization: Bearer <token>',
    '{"access_token":"<uvw_at_… 52 chars>","refresh_token":"[REDACTED]"}',
    'workspace_session=<session>',
    'Set-Cookie: workspace_handoff=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    JSON.stringify({ input: { code: 'return tools.ws.whoami()', state: 'open', token: 'page-2' }, tokens: { input: 12 } }),
  ]) {
    assert.equal(redact(text), text);
    assert.deepEqual(findSecrets(text), []);
  }
});

test('a sign-in transcript also loses its OAuth flow values and colours, and keeps its challenge', () => {
  const tool = JSON.stringify({ type: 'tool_use', input: { code: 'return tools["ws"].whoami();', state: 'private-state' }, output: 'ok' });
  assert.deepEqual(JSON.parse(redactSignIn(tool)), { type: 'tool_use', input: { code: '[REDACTED]', state: '[REDACTED]' }, output: 'ok' });
  assert.equal(redactSignIn('\x1b[32mGET /callback?code=c0de&state=s1&code_challenge=ch\x1b[0m'), 'GET /callback?code=[REDACTED]&state=[REDACTED]&code_challenge=[REDACTED]');
  const challenge = 'WWW-Authenticate: Bearer resource_metadata="http://127.0.0.1:3930/.well-known/oauth-protected-resource/mcp"';
  assert.equal(redactSignIn(challenge), challenge);
  assert.equal(redactSignIn(`token ${pat} and run-secret-1`, ['run-secret-1']), 'token [REDACTED] and [REDACTED]');
});

test('a secret of the run is removed by value even when it has no recognisable shape', () => {
  assert.equal(redact('password hunter2-opaque and hunter2-opaque', ['hunter2-opaque', '']), 'password [REDACTED] and [REDACTED]');
  assert.deepEqual(findSecrets('x hunter2-opaque', ['hunter2-opaque']), ['a secret of this run']);
});

test('stored credentials give up their secret leaves and keep their labels', () => {
  const exported = [{ id: 'cred_1', integrationID: 'opencode', label: 'Personal', value: { type: 'oauth', access: 'access-secret-1', refresh: 'refresh-secret-1', expires: 1, metadata: { email: 'dev@example.com', server: 'https://example.com' } } }];
  assert.deepEqual(credentialSecrets(exported), ['access-secret-1', 'refresh-secret-1', 'dev@example.com']);
  assert.deepEqual(credentialSecrets({ type: 'api', key: 'sk-12345678' }), ['sk-12345678']);
});

test('run secrets cover the human, the principals, the model credential, story shell variables and story uvw sessions, and the check fails on any of them', () => {
  const run = mkdtempSync(join(tmpdir(), 'verify-uvw-secrets-'));
  const check = () => spawnSync(process.execPath, [join(run, 'bin/secrets.mjs'), 'check', run, join(run, 'evidence')], { encoding: 'utf8' });
  try {
    // The helper names this file through a symlinked path (/tmp on macOS); the check must still run.
    symlinkSync(fileURLToPath(new URL('.', import.meta.url)), join(run, 'bin'));
    const sessions = 'distributions/univer-workspace-cli/workspace-cli';
    for (const directory of ['home/principals', 'home/stories/codex-human/.codex', `home/${sessions}`, `home/stories/uvw-a1/.univer-workspace-cli/${sessions}`, 'evidence/story']) mkdirSync(join(run, directory), { recursive: true });
    writeFileSync(join(run, 'user.pw'), 'human-password');
    writeFileSync(join(run, 'home/mcp-session'), 'human-session\n');
    writeFileSync(join(run, 'home/browser-session'), 'human-browser-session\n');
    writeFileSync(join(run, 'home/principals/a1.token'), 'principal-token\n');
    writeFileSync(join(run, 'home/principals/a1.id'), 'principal-id\n');
    writeFileSync(join(run, 'home/opencode-credential-opencode.json'), JSON.stringify([{ value: { access: 'model-access', refresh: 'model-refresh' } }]));
    writeFileSync(join(run, 'home/story-env.json'), JSON.stringify({ DEEPSEEK_API_KEY: 'story-env-key', PROVIDER_REGION: 'story-env-region' }));
    writeFileSync(join(run, 'home/stories/codex-human/.codex/auth.json'), JSON.stringify({ tokens: { access_token: 'codex-access', refresh_token: 'codex-refresh', id_token: 'codex-id-token' }, OPENAI_API_KEY: 'codex-api-key' }));
    const stored = cookie => JSON.stringify({ sessions: { 'http://127.0.0.1:1': { cookie, subject: { id: 'subject-id-1' } } } });
    writeFileSync(join(run, `home/${sessions}/session.json`), stored('human-cli-session'));
    writeFileSync(join(run, `home/stories/uvw-a1/.univer-workspace-cli/${sessions}/session.json`), stored('story-session'));
    assert.deepEqual(runSecrets(run).sort(), ['codex-access', 'codex-api-key', 'codex-id-token', 'codex-refresh', 'human-browser-session', 'human-cli-session', 'human-password', 'human-session', 'model-access', 'model-refresh', 'principal-token', 'story-env-key', 'story-env-region', 'story-session']);

    writeFileSync(join(run, 'evidence/story/transcript.jsonl'), 'agent principal-id said hello\n');
    assert.equal(check().status, 0, check().stdout);
    assert.match(check().stdout, /^ok {4}no token, session cookie or run secret in 1 files/);
    writeFileSync(join(run, 'evidence/story/answer.txt'), `link and ${pat}\n`);
    writeFileSync(join(run, 'evidence/leak.txt'), 'model-refresh\n');
    writeFileSync(join(run, 'evidence/env-leak.txt'), 'region story-env-region\n');
    const failed = check();
    assert.equal(failed.status, 1);
    assert.deepEqual(failed.stdout.trim().split('\n').sort(), ['FAIL  env-leak.txt: a secret of this run', 'FAIL  leak.txt: a secret of this run', 'FAIL  story/answer.txt: Workspace token']);
    assert.doesNotMatch(failed.stdout + failed.stderr, /uvw_pat_|model-refresh|story-env-region/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('a claim code fails the check and stays readable for the recipe, and the printed command redacts it', () => {
  const code = randomBytes(16).toString('base64url');
  const url = `http://127.0.0.1:5993/claim/${code}`;
  for (const text of [url, `{"claimUrl": "${url}", "expiresAt": "2026-11-24T10:00:00Z"}`, `Handoff link: ${url}\n`]) {
    assert.deepEqual(findSecrets(text), ['claim code'], text);
    assert.equal(redact(text), text);
  }
  for (const text of ['/claim/<code>', '/claim/<redacted>', '/claim/[REDACTED]', '$ORIGIN/claim/not-a-real-code', '/claim/:code', `/claim/${code}x`]) {
    assert.deepEqual(findSecrets(text), [], text);
  }

  const run = mkdtempSync(join(tmpdir(), 'verify-uvw-claim-'));
  const check = () => spawnSync(process.execPath, [fileURLToPath(new URL('./secrets.mjs', import.meta.url)), 'check', run, join(run, 'evidence')], { encoding: 'utf8' });
  try {
    mkdirSync(join(run, 'evidence'));
    const out = `{\n  "claimUrl": "${url}",\n  "expiresAt": "2026-11-24T10:00:00Z"\n}\n`;
    writeFileSync(join(run, 'evidence/mh-bot1-claim.out'), out);
    writeFileSync(join(run, "evidence/it's claimed.txt"), `opened ${url} and $ORIGIN/claim/not-a-real-code\n`);
    const failed = check();
    assert.equal(failed.status, 1);
    const lines = failed.stdout.trim().split('\n');
    assert.deepEqual(lines.slice(0, 2).sort(), ["FAIL  it's claimed.txt: claim code", 'FAIL  mh-bot1-claim.out: claim code']);
    assert.equal(lines[2], 'Once the handoff link has been used, redact its code with:');
    assert.doesNotMatch(failed.stdout, new RegExp(code));
    assert.equal(spawnSync('sh', ['-c', lines[3]], { encoding: 'utf8' }).status, 0, lines[3]);
    assert.equal(check().status, 0, check().stdout);
    assert.equal(readFileSync(join(run, 'evidence/mh-bot1-claim.out'), 'utf8'), out.replace(code, '[REDACTED]'));
    assert.equal(readFileSync(join(run, "evidence/it's claimed.txt"), 'utf8'), 'opened http://127.0.0.1:5993/claim/[REDACTED] and $ORIGIN/claim/not-a-real-code\n');
  } finally { rmSync(run, { recursive: true, force: true }); }
});
