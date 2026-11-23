import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const skill = fileURLToPath(new URL('..', import.meta.url));
const docs = ['SKILL.md', ...['references', 'features'].flatMap((dir) =>
  readdirSync(join(skill, dir)).filter((name) => name.endsWith('.md')).map((name) => join(dir, name)))];

const prose = (file) => readFileSync(file, 'utf8').split(/^```.*$/m).filter((_, i) => i % 2 === 0).join('\n');

// GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens, repeats numbered.
const anchors = (file) => {
  const seen = new Map();
  return new Set([...prose(file).matchAll(/^#{1,6} +(.+)$/gm)].map(([, text]) => {
    const slug = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim().toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    return n ? `${slug}-${n}` : slug;
  }));
};

test('every relative link in the skill resolves to a file and a heading', () => {
  const broken = [];
  for (const doc of docs) {
    const from = join(skill, doc);
    for (const [, target] of prose(from).matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/.test(target)) continue;
      const [path, anchor] = target.split('#');
      const file = path ? resolve(dirname(from), path) : from;
      if (!existsSync(file)) broken.push(`${doc}: ${target} (no file)`);
      else if (anchor && file.endsWith('.md') && !anchors(file).has(decodeURIComponent(anchor))) broken.push(`${doc}: ${target} (no heading)`);
    }
  }
  assert.deepEqual(broken, []);
});

test('the sections that brief names exist in SKILL.md', () => {
  const helper = readFileSync(join(skill, 'bin/verify-uvw'), 'utf8');
  const [, first, second] = helper.match(/Read the (\w+) and (\w+) sections of \.agents\/skills\/verify-uvw\/SKILL\.md/);
  const headings = anchors(join(skill, 'SKILL.md'));
  for (const name of [first, second]) assert.ok(headings.has(name.toLowerCase()), `SKILL.md has no "## ${name}"`);
});

test('every VERIFY_UVW_ variable the helper reads is documented', () => {
  const helper = readFileSync(join(skill, 'bin/verify-uvw'), 'utf8');
  const documented = ['SKILL.md', 'references/mcp-mode.md', 'references/stories.md'].map((doc) => readFileSync(join(skill, doc), 'utf8')).join('\n');
  const read = new Set([...helper.matchAll(/\$\{?(VERIFY_UVW_[A-Z_]+)/g)].map(([, name]) => name));
  const missing = [...read].filter((name) => !documented.includes(name));
  assert.ok(read.has('VERIFY_UVW_MCP_SAME_ORIGIN'), 'the pattern finds the variables the helper reads');
  assert.deepEqual(missing, []);
});
