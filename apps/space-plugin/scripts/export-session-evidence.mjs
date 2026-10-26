import { writeEvidence } from './evidence-output.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/export-session-evidence.mjs <session.v4.jsonl.zstd>');
const decoded = spawnSync('zstd', ['-dc', path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
if (decoded.status !== 0) throw new Error('zstd could not decode the native Session log.');
const rows = decoded.stdout.trim().split('\n').map(line => JSON.parse(line));
const header = rows[0];
assert.equal(header.type, 'session');
const textOf = parts => parts.filter(c => c.type === 'text').map(c => c.text).join('\n');
const events = rows.filter(x => x.type === 'request/context' || ['turn/start', 'turn/end'].includes(x.type) || x.type === 'assistant/message' || (x.type === 'user/message' && x.data.source?.kind === 'user')).map(x =>
  x.type === 'assistant/message' ? { seq: x.seq, type: x.type, time: x.time, turn: x.data.turn, step: x.data.step, text: textOf(x.data.message.content) } :
  x.type === 'user/message' ? { seq: x.seq, type: x.type, time: x.time, text: textOf(x.data.content) } : x);
assert.ok(events.some(x => x.type === 'request/context' && x.data.model === 'deepseek-flash'));
assert.ok(events.some(x => x.type === 'user/message' && x.text.includes('<workspace_snapshot>')));
assert.ok(events.some(x => x.type === 'assistant/message' && x.text.includes('SPACE-ORBIT-7419') && x.text.includes('4270')));
const result = { sessionId: header.id, cwd: header.cwd, compressedLogSha256: createHash('sha256').update(await readFile(path)).digest('hex'), source: 'Official DSH Session log. Whitelisted user/assistant text, turn boundaries and model context; no system prompts, request headers, environment or credentials.', events };
await writeEvidence('session.json', result);
console.log(JSON.stringify({ sessionId: header.id, turns: events.filter(x => x.type === 'turn/end').length, model: 'deepseek-flash', verified: true }));
