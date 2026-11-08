#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const [mode, envelope, path] = process.argv.slice(2);
assert(['put', 'get'].includes(mode) && envelope && path, 'Usage: mcp-file.mjs put|get <tool-output.json> <file>');
const result = JSON.parse(await readFile(envelope, 'utf8'));
const url = mode === 'put' ? result.upload.upload_url : result.download.url;
const bytes = mode === 'put' ? await readFile(path) : undefined;
const response = await fetch(url, { method: mode === 'put' ? 'PUT' : 'GET', ...(bytes ? { body: bytes, headers: { 'Content-Length': String(bytes.length) } } : {}) });
assert(response.ok, `File ${mode} returned HTTP ${response.status}`);
if (mode === 'get') {
  assert.match(response.headers.get('content-disposition'), /^attachment;/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('content-security-policy'), "sandbox; default-src 'none'");
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  await writeFile(path, new Uint8Array(await response.arrayBuffer()));
  await writeFile(path + '.headers.json', JSON.stringify(Object.fromEntries(response.headers), null, 2) + '\n');
}
console.log(`File ${mode} succeeded`);
