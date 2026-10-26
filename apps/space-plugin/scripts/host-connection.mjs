import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** Validation helper only. Uses the official launch-token owner exchange. */
export async function connectHost() {
  const log = await readFile(process.env.SPACE_DSH_LOG ?? '/tmp/task005-desktop-private.log', 'utf8');
  const tokenURL = log.match(/dsh web: (https?:\/\/\S+)/)?.[1];
  if (!tokenURL) throw new Error('SPACE_DSH_LOG must name the private Desktop launcher log.');
  const origin = new URL(tokenURL).origin;
  if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Validation requires a local Host.');
  const admission = await fetch(tokenURL, { redirect: 'manual' });
  const cookie = admission.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Official owner authentication failed.');
  const headers = { cookie, 'content-type': 'application/json' };
  const body = (method, payload) => JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload });
  async function request(method, payload = {}) {
    const response = await fetch(`${origin}/api/${method}`, { method: 'POST', headers, body: body(method, payload) });
    if (!response.ok) throw new Error(`Host returned HTTP ${response.status}.`);
    const envelope = await response.json();
    if (!envelope.result.ok) throw new Error(envelope.result.error.message);
    return envelope.result.value;
  }
  return { origin, headers, body, request };
}
