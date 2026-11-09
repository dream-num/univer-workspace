#!/usr/bin/env node
// Reads renderer-call.mjs output on stdin and writes <prefix>.json (header) plus the payload files:
// <prefix>-<image name> for screenshot images and <prefix>.pdf for printPdf. Exits 1 when the call failed.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const prefix = process.argv[2];
const { header, payload } = JSON.parse(readFileSync(0, 'utf8'));
const bytes = Buffer.from(payload, 'base64');
writeFileSync(`${prefix}.json`, JSON.stringify(header, null, 2) + '\n');
if (!header.ok) {
  console.error(`renderer error ${header.error.code}: ${header.error.message}`);
  process.exit(1);
}
const written = [`${prefix}.json`];
for (const image of header.output.images ?? []) {
  const path = `${prefix}-${basename(image.name)}`;
  writeFileSync(path, bytes.subarray(image.offset, image.offset + image.size));
  written.push(path);
}
if (header.output.mediaType === 'application/pdf') {
  writeFileSync(`${prefix}.pdf`, bytes);
  written.push(`${prefix}.pdf`);
}
console.log(written.join('\n'));
