#!/usr/bin/env node
// Runs inside the executor container: node --input-type=module -e "$(cat renderer-call.mjs)" <op>
// Reads the operation input as JSON on stdin, calls MCP_RENDERER_URL with MCP_RENDERER_TOKEN, and prints
// {header, payload} where payload is base64.
import { decodeFrame, encodeFrame, FRAME_CONTENT_TYPE } from './dist/shared/frame.js';

const op = process.argv[1];
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const response = await fetch(new URL(`/rpc/v1/${op}`, process.env.MCP_RENDERER_URL), {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.MCP_RENDERER_TOKEN}`, 'content-type': FRAME_CONTENT_TYPE, 'x-mcp-rpc-version': '1' },
  body: encodeFrame({ v: 1, op, requestId: `renderer-call-${Date.now()}`, deadlineMs: op === 'measureText' ? 9000 : 28000, input: JSON.parse(Buffer.concat(chunks).toString('utf8')) }),
  signal: AbortSignal.timeout(40000),
});
if (!response.ok) throw new Error(`RPC transport rejected: ${response.status}`);
const { header, payload } = decodeFrame(new Uint8Array(await response.arrayBuffer()));
console.log(JSON.stringify({ header, payload: Buffer.from(payload).toString('base64') }));
