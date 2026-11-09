#!/usr/bin/env node
// Runs inside the executor container: node --input-type=module -e "$(cat renderer-bench-load.mjs)"
// Reads {phases:[{name, concurrency, calls|seconds, call:{label, op, input, deadlineMs}}]} as JSON on stdin and calls
// MCP_RENDERER_URL like the executor does. Phases run in order. `calls` is a shared budget of calls across the workers;
// `seconds` makes each worker loop until the window ends. Prints {phases:[{name, startedAt, elapsedMs, rows}]} where each row
// has startMs/endMs relative to the phase start, the renderer's own accounting and a check that the output is real.
import { decodeFrame, encodeFrame, FRAME_CONTENT_TYPE } from './dist/shared/frame.js';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const plan = JSON.parse(Buffer.concat(chunks).toString('utf8'));

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const startsWith = (bytes, magic) => bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);
// A screenshot must start with the PNG signature and a PDF with %PDF; measureText has no payload and must report lines.
function output(op, header, payload) {
  if (op === 'screenshot') return { real: header.output.images.length > 0 && header.output.images.every((i) => startsWith(payload.subarray(i.offset, i.offset + i.size), PNG)), images: header.output.images.length };
  if (op === 'printPdf') return { real: startsWith(payload, [0x25, 0x50, 0x44, 0x46]) && header.output.pageCount > 0, pages: header.output.pageCount };
  if (op === 'measureText') return { real: header.output.lineCount >= 1 && header.output.actualHeight > 0, lines: header.output.lineCount };
  return { real: header.ok };
}

async function once(spec, origin, sequence) {
  const op = spec.call.op;
  const started = performance.now();
  const row = { label: spec.call.label, op, startMs: started - origin };
  try {
    const response = await fetch(new URL(`/rpc/v1/${op}`, process.env.MCP_RENDERER_URL), {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.MCP_RENDERER_TOKEN}`, 'content-type': FRAME_CONTENT_TYPE, 'x-mcp-rpc-version': '1' },
      body: encodeFrame({ v: 1, op, requestId: `bench-${Date.now()}-${sequence}`, deadlineMs: spec.call.deadlineMs ?? (op === 'measureText' ? 9000 : 28000), input: spec.call.input }),
      signal: AbortSignal.timeout(40000),
    });
    if (!response.ok) Object.assign(row, { ok: false, transport: response.status });
    else {
      const { header, payload } = decodeFrame(new Uint8Array(await response.arrayBuffer()));
      row.ok = header.ok;
      row.payloadBytes = payload.length;
      row.executor = header.meta?.executor;
      row.renderPages = header.meta?.cost?.render_pages;
      if (header.ok) Object.assign(row, output(op, header, payload));
      else Object.assign(row, { code: header.error.code, retryable: header.error.detail?.retryable ?? null, reason: header.error.detail?.reason ?? null });
    }
  } catch (error) {
    Object.assign(row, { ok: false, transport: error.name, message: error.message });
  }
  row.endMs = performance.now() - origin;
  row.ms = performance.now() - started;
  return row;
}

const result = { phases: [] };
let sequence = 0;
for (const phase of plan.phases) {
  const origin = performance.now();
  const startedAt = new Date().toISOString();
  const rows = [];
  let remaining = phase.calls ?? Infinity;
  const worker = async () => {
    while (phase.seconds ? performance.now() - origin < phase.seconds * 1000 : remaining > 0) {
      remaining--;
      rows.push(await once(phase, origin, sequence++));
    }
  };
  await Promise.all(Array.from({ length: phase.concurrency }, worker));
  result.phases.push({ name: phase.name, startedAt, elapsedMs: performance.now() - origin, rows });
}
console.log(JSON.stringify(result));
