#!/usr/bin/env node
// Prints the session of the verifier that verify-uvw delegate started as markdown, read from that agent's own record.
// verifier-transcript.mjs --kind <kind> --repo <dir> --since <epoch-ms> --prompt-file <path> [--run <run>]
// Exits 3 when the agent kind has no reader, and 1 when no session matches or its format is not understood.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { redact, runSecrets } from './secrets.mjs';

// A margin for coarse timestamps: the verifier's session starts after since.
const SLACK_MS = 5000;
const OUTPUT_LINES = 40;
const normalize = (text) => text.trim().replace(/\s+/g, ' ');
const modelName = (provider, id, variant) => `${provider ? `${provider}/` : ''}${id ?? 'unknown'}${variant ? `#${variant}` : ''}`;
// opencode parts are text, codex parts input_text or output_text; an image or file shows only its type.
const partsText = (parts) => parts.map((part) => (part.type.endsWith('text') ? part.text : `[${part.type}]`)).join('\n');

function findOpencode({ repo, since, prompt }) {
  const opencode = (...args) => JSON.parse(execFileSync('opencode', args, {
    cwd: repo, encoding: 'utf8', maxBuffer: Infinity, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  // shortcut: reads the 20 sessions of this project updated last; page through more if parallel runs push it out.
  const sessions = opencode('session', 'list', '--standalone', '--format', 'json', '-n', '20')
    .filter((session) => session.directory === repo && session.created >= since - SLACK_MS)
    .sort((a, b) => a.created - b.created);
  for (const { id } of sessions) {
    const { info, messages } = opencode('session', 'export', '--standalone', id);
    if (normalize(messages.find((message) => message.type === 'user')?.text ?? '') !== prompt) continue;
    return { id, model: modelName(info.model?.providerID, info.model?.id, info.model?.variant), entries: messages.flatMap(opencodeEntries) };
  }
  throw new Error(`no opencode session in ${repo} since ${new Date(since).toISOString()} starts with this prompt`);
}

function opencodeEntries(message) {
  if (message.type === 'user') return [{ role: 'user', text: message.text }];
  if (message.type !== 'assistant') return [];
  return message.content.flatMap((part) => {
    if (part.type === 'text') return [{ role: 'assistant', text: part.text }];
    if (part.type !== 'tool') return [];
    const { input, content = [], metadata } = part.state;
    const shown = part.name === 'shell' ? input?.command : JSON.stringify(input);
    return [{ role: 'tool', name: part.name, input: shown, output: partsText(content), exit: metadata?.exit }];
  });
}

function findCodex({ repo, since, prompt }) {
  const from = since - SLACK_MS;
  const sessions = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
  const pad = (n) => String(n).padStart(2, '0');
  const candidates = [];
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  for (; day <= Date.now(); day.setDate(day.getDate() + 1)) {
    const dir = join(sessions, String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate()));
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      const file = join(dir, name);
      if (!name.endsWith('.jsonl') || statSync(file).mtimeMs < from) continue;
      // Another codex, such as the orchestrator itself, may be mid-write, so a torn last line is skipped.
      const lines = readFileSync(file, 'utf8').split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
      const meta = lines.find((line) => line.type === 'session_meta')?.payload;
      if (meta?.cwd !== repo || Date.parse(meta.timestamp) < from) continue;
      const items = lines.filter((line) => line.type === 'response_item').map((line) => line.payload);
      // codex sends its own user messages first, such as the AGENTS.md instructions, so the transcript starts at the prompt.
      const start = items.findIndex((item) => item.type === 'message' && item.role === 'user' && normalize(partsText(item.content)) === prompt);
      if (start < 0) continue;
      const context = lines.find((line) => line.type === 'turn_context')?.payload;
      const model = modelName(meta.model_provider, context?.model, context?.effort);
      candidates.push({ created: Date.parse(meta.timestamp), id: meta.id, model, items: items.slice(start) });
    }
  }
  const match = candidates.sort((a, b) => a.created - b.created)[0];
  if (!match) throw new Error(`no codex session in ${repo} since ${new Date(since).toISOString()} holds this prompt`);
  return { id: match.id, model: match.model, entries: codexEntries(match.items) };
}

function codexEntries(items) {
  const calls = new Map();
  return items.flatMap((item) => {
    if (item.type === 'message') return item.role === 'user' || item.role === 'assistant' ? [{ role: item.role, text: partsText(item.content) }] : [];
    if (item.type === 'custom_tool_call' || item.type === 'function_call') {
      calls.set(item.call_id, { role: 'tool', name: item.name, input: item.input ?? item.arguments, output: '' });
      return [calls.get(item.call_id)];
    }
    if (item.type === 'custom_tool_call_output' || item.type === 'function_call_output') Object.assign(calls.get(item.call_id) ?? {}, codexOutput(item.output));
    return [];
  });
}

// codex's exec tool answers with a "Script completed" header and then the JSON result of the one command it ran.
// shortcut: exec input is JavaScript and shows as written; pull the command out if multi-line commands read badly.
function codexOutput(output) {
  if (typeof output === 'string') return { output };
  const parts = output.map((part) => (part.type.endsWith('text') ? part.text : `[${part.type}]`));
  let result;
  try { result = parts.length === 2 ? JSON.parse(parts[1]) : undefined; } catch {}
  return typeof result?.output === 'string' ? { output: result.output, exit: result.exit_code } : { output: parts.join('\n') };
}

// A fence longer than any run of backticks in the text, so a command's markdown output cannot close it.
const fence = (text) => {
  const ticks = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(([run]) => run.length + 1)));
  return `${ticks}\n${text}\n${ticks}`;
};

function render(kind, { id, model, entries }, brief) {
  const prompt = normalize(brief);
  const final = entries.findLastIndex((entry) => entry.role === 'assistant');
  const blocks = [`# ${kind} session ${id}`, `Model: ${model}`];
  entries.forEach((entry, index) => {
    if (entry.role === 'user') {
      blocks.push(normalize(entry.text) === prompt ? `**Brief:** identical to \`$V brief\` (${Buffer.byteLength(brief)} bytes)` : `**User:**\n\n${entry.text}`);
    } else if (entry.role === 'assistant') {
      blocks.push(index === final ? `**Final answer:**\n\n${entry.text}` : entry.text);
    } else {
      blocks.push(`**${entry.name}**${entry.exit == null ? '' : ` (exit ${entry.exit})`}`);
      if (entry.input) blocks.push(fence(entry.input.trimEnd()));
      const lines = entry.output.trimEnd().split('\n');
      const more = lines.length - OUTPUT_LINES;
      if (entry.output.trim()) blocks.push(fence(lines.slice(0, OUTPUT_LINES).join('\n')) + (more > 0 ? `\n… ${more} more lines` : ''));
    }
  });
  return `${blocks.join('\n\n')}\n`;
}

const readers = { opencode: findOpencode, codex: findCodex };

const { values } = parseArgs({ options: Object.fromEntries(['kind', 'repo', 'since', 'prompt-file', 'run'].map((name) => [name, { type: 'string' }])) });
const since = Number(values.since);
if (!values.kind || !values.repo || !values['prompt-file'] || !values.since || !Number.isFinite(since)) {
  console.error('usage: verifier-transcript.mjs --kind <kind> --repo <dir> --since <epoch-ms> --prompt-file <path> [--run <run>]');
  process.exit(2);
}
const find = Object.hasOwn(readers, values.kind) && readers[values.kind];
if (!find) {
  console.error(`no transcript reader for ${values.kind} agents`);
  process.exit(3);
}
try {
  const brief = readFileSync(values['prompt-file'], 'utf8');
  const markdown = render(values.kind, find({ repo: realpathSync(values.repo), since, prompt: normalize(brief) }), brief);
  process.stdout.write(redact(markdown, values.run ? runSecrets(values.run) : []));
} catch (error) {
  console.error(`cannot read the ${values.kind} session: ${normalize(error.message)}`);
  process.exit(1);
}
