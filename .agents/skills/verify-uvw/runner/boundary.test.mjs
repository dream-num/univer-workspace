import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const skill = fileURLToPath(new URL('..', import.meta.url));

// What names the runner outside runner/: a path into it, its name, and what only it uses.
const TOKENS = {
  'runner/': /\brunner\//,
  'the runner': /\b(?:the|a|verify)[- ]runner\b|mode:runner/i,
  VERIFY_UVW_RUNNER: /VERIFY_UVW_RUNNER/,
  'dist start mode': /VERIFY_UVW_MCP_FROM|\bMCP_FROM\b|\bmcp_from\b|dist start mode|mcp-processes/,
  VERIFY_UVW_EVIDENCE_ROOT: /VERIFY_UVW_EVIDENCE_ROOT/,
  VERIFY_UVW_SKIP_JOURNEYS: /VERIFY_UVW_SKIP_JOURNEYS/,
  'host-only.mjs': /host-only\.mjs/,
};

// Every file outside runner/ that keeps a hook for it, with the tokens the hook has. "Remove the runner" in
// README.md deletes them all.
const HOOKS = {
  // The paragraph that makes the runner opt-in.
  'SKILL.md': ['runner/', 'the runner'],
  // The start mode the runner's containers use instead of the MCP image, gated on the image's VERIFY_UVW_RUNNER=1,
  // and the evidence links into the runner's host mount in cmd_up.
  'bin/verify-uvw': ['runner/', 'the runner', 'VERIFY_UVW_RUNNER', 'dist start mode', 'VERIFY_UVW_EVIDENCE_ROOT'],
  // The dist start mode's checks and log reads.
  'bin/executor-doctor.mjs': ['runner/', 'dist start mode'],
  'bin/renderer-doctor.mjs': ['runner/', 'dist start mode'],
  'bin/mcp-call.mjs': ['dist start mode'],
  // The fold across every run under the evidence root, and the journeys run-journeys must leave out.
  'bin/journeys.mjs': ['VERIFY_UVW_EVIDENCE_ROOT', 'VERIFY_UVW_SKIP_JOURNEYS'],
  // The one pointer from MCP mode to the dist start mode.
  'references/mcp-mode.md': ['runner/', 'the runner', 'dist start mode'],
};

test('outside runner/, only the hooks listed here name the runner, and each listed hook is still there', () => {
  const found = {};
  for (const file of readdirSync(skill, { recursive: true }).sort()) {
    if (file.startsWith('runner/') || !statSync(join(skill, file)).isFile()) continue;
    const text = readFileSync(join(skill, file), 'utf8');
    const tokens = Object.keys(TOKENS).filter((token) => TOKENS[token].test(text));
    if (tokens.length) found[file] = tokens;
  }
  assert.deepEqual(found, HOOKS);
});
