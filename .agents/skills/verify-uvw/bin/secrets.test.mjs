import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { credentialSecrets, findSecrets, redact, runSecrets } from './secrets.mjs';

const pat = 'uvw_pat_3fJk-9a.B_c~d', session = 'c2Vzc2lvbi1zZWNyZXQtdmFsdWU';

test('token, cookie, bearer and OAuth field shapes are redacted and nothing is left to find', () => {
  const cases = [
    [`token ${pat} end`, 'token [REDACTED] end', 'Workspace token'],
    ['uvw_at_abc and uvw_rt_def', '[REDACTED] and [REDACTED]', 'Workspace token'],
    [`Cookie: workspace_session=${session}; Path=/`, 'Cookie: workspace_session=[REDACTED]; Path=/', 'session cookie'],
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
    JSON.stringify({ input: { code: 'return tools.ws.whoami()', state: 'open', token: 'page-2' }, tokens: { input: 12 } }),
  ]) {
    assert.equal(redact(text), text);
    assert.deepEqual(findSecrets(text), []);
  }
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

test('run secrets cover the human, the principals, the model credential and story uvw sessions, and the check fails on any of them', () => {
  const run = mkdtempSync(join(tmpdir(), 'verify-uvw-secrets-'));
  const check = () => spawnSync(process.execPath, [join(run, 'bin/secrets.mjs'), 'check', run, join(run, 'evidence')], { encoding: 'utf8' });
  try {
    // The helper names this file through a symlinked path (/tmp on macOS); the check must still run.
    symlinkSync(fileURLToPath(new URL('.', import.meta.url)), join(run, 'bin'));
    const sessions = 'distributions/univer-workspace-cli/workspace-cli';
    for (const directory of ['home/principals', 'home/stories/codex-human/.codex', `home/${sessions}`, `home/stories/uvw-a1/.univer-workspace-cli/${sessions}`, 'evidence/story']) mkdirSync(join(run, directory), { recursive: true });
    writeFileSync(join(run, 'user.pw'), 'human-password');
    writeFileSync(join(run, 'home/mcp-session'), 'human-session\n');
    writeFileSync(join(run, 'home/principals/a1.token'), 'principal-token\n');
    writeFileSync(join(run, 'home/principals/a1.id'), 'principal-id\n');
    writeFileSync(join(run, 'home/opencode-credential.json'), JSON.stringify([{ value: { access: 'model-access', refresh: 'model-refresh' } }]));
    writeFileSync(join(run, 'home/stories/codex-human/.codex/auth.json'), JSON.stringify({ tokens: { access_token: 'codex-access', refresh_token: 'codex-refresh', id_token: 'codex-id-token' }, OPENAI_API_KEY: 'codex-api-key' }));
    const stored = cookie => JSON.stringify({ sessions: { 'http://127.0.0.1:1': { cookie, subject: { id: 'subject-id-1' } } } });
    writeFileSync(join(run, `home/${sessions}/session.json`), stored('human-cli-session'));
    writeFileSync(join(run, `home/stories/uvw-a1/.univer-workspace-cli/${sessions}/session.json`), stored('story-session'));
    assert.deepEqual(runSecrets(run).sort(), ['codex-access', 'codex-api-key', 'codex-id-token', 'codex-refresh', 'human-cli-session', 'human-password', 'human-session', 'model-access', 'model-refresh', 'principal-token', 'story-session']);

    writeFileSync(join(run, 'evidence/story/transcript.jsonl'), 'agent principal-id said hello\n');
    assert.equal(check().status, 0, check().stdout);
    assert.match(check().stdout, /^ok {4}no token, session cookie or run secret in 1 files/);
    writeFileSync(join(run, 'evidence/story/answer.txt'), `link and ${pat}\n`);
    writeFileSync(join(run, 'evidence/leak.txt'), 'model-refresh\n');
    const failed = check();
    assert.equal(failed.status, 1);
    assert.deepEqual(failed.stdout.trim().split('\n').sort(), ['FAIL  leak.txt: a secret of this run', 'FAIL  story/answer.txt: Workspace token']);
    assert.doesNotMatch(failed.stdout + failed.stderr, /uvw_pat_|model-refresh/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});
