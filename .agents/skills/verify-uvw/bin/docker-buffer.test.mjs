import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Returns the argument text of the call whose opening parenthesis is at `open`, skipping string contents.
function callArguments(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === "'" || char === '"' || char === '`') {
      for (i++; i < source.length && source[i] !== char; i++) if (source[i] === '\\') i++;
    } else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

test('every synchronous docker call sets maxBuffer, because container logs outgrow the 1 MiB default in long runs', () => {
  const dir = new URL('.', import.meta.url);
  const offenders = readdirSync(dir)
    .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .flatMap((name) => {
      const source = readFileSync(new URL(name, dir), 'utf8');
      return [...source.matchAll(/execFileSync\('docker'/g)]
        .filter((match) => !callArguments(source, match.index + 'execFileSync'.length).includes('maxBuffer'))
        .map((match) => `${name}:${source.slice(0, match.index).split('\n').length}`);
    });
  assert.deepEqual(offenders, []);
});
