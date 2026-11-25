#!/usr/bin/env node
// Submits one changeset to a Trunk Sheet the way the Browser's collaboration client does: join the Unit over the
// realtime socket, POST new_changes at head, and print the event the socket answers with, as
// {"event":"changeset_ack"|"permission_rej"|...,"baseRev":<head>}. ORIGIN comes from `$V env`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [jar, unitId, mutationId, params = '{}'] = process.argv.slice(2);
assert(jar && unitId && mutationId, 'Usage: trunk-changeset.mjs <curl-cookie-jar> <sheet-unit-id> <mutation-id> [params-json]');
const origin = process.env.ORIGIN;
assert(origin, 'ORIGIN is not set; run eval "$($V env)" first');
const session = readFileSync(jar, 'utf8').split('\n').map((line) => line.split('\t')).find((f) => f[5] === 'workspace_session')?.[6];
assert(session, `${jar} holds no workspace_session cookie`);
const cookie = `workspace_session=${session}`;
// The SDK packages are dependencies of the Workspace app, not of the repository root.
const sdk = createRequire(new URL('../../../../apps/workspace/package.json', import.meta.url));
const load = (name) => import(pathToFileURL(sdk.resolve(name)).href);
const { serializeCombRequest, deserializeToCombResponse } = await load('@univerjs-pro/collaboration-client');
const { CombCmd, UniverType } = await load('@univerjs/protocol');
const type = UniverType.UNIVER_SHEET;

const json = async (response) => ({ status: response.status, body: await response.json() });
const head = await json(await fetch(`${origin}/universer-api/snapshot/${type}/unit/${unitId}/rev/0`, { headers: { cookie } }));
assert.equal(head.body.error?.code, 1, `snapshot read failed: ${JSON.stringify(head.body.error ?? head.status)}`);
// The stored snapshot can lag head; the changesets after it reach head. A restore commits only at head.
const baseRev = head.body.changesets?.at(-1)?.revision ?? head.body.snapshot.rev;
const subUnitId = head.body.snapshot.workbook.sheetOrder[0];
const { ticket } = (await json(await fetch(`${origin}/universer-api/user/session-ticket`, { headers: { cookie } }))).body;
const socket = new WebSocket(`${origin.replace(/^http/, 'ws')}/universer-api/comb/connect?sessionTicket=${encodeURIComponent(ticket)}`);
const messages = [];
let wake = () => {};
socket.addEventListener('message', (event) => { messages.push(deserializeToCombResponse(event)); wake(); });
const next = async (match) => {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const found = messages.findIndex(match);
    if (found >= 0) return messages.splice(found, 1)[0];
    assert(Date.now() < deadline, 'the realtime socket did not answer within 10 s');
    await new Promise((resolve) => { wake = resolve; setTimeout(resolve, 200); });
  }
};
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
socket.send(serializeCombRequest({ cmd: CombCmd.HELLO, routeKey: 'hello', routeType: '' }));
const memberID = (await next((m) => m.cmd === CombCmd.HELLO)).data.memberID;
socket.send(serializeCombRequest({ cmd: CombCmd.JOIN, routeKey: unitId, routeType: '', data: { rooms: [{ roomID: unitId, args: '' }] } }));
await next((m) => m.cmd === CombCmd.JOIN);
const reqId = 1;
const posted = await json(await fetch(`${origin}/universer-api/comb/${type}/unit/${unitId}/new_changes`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({
    unitID: unitId, memberID, type,
    changeset: {
      unitID: unitId, type, baseRev, revision: baseRev + 1, sid: memberID, reqId, userID: '', memberID,
      mutations: [{ id: mutationId, data: JSON.stringify({ unitId, subUnitId, ...JSON.parse(params) }) }],
    },
  }),
}));
assert.equal(posted.body.error?.code, 1, `new_changes refused the request: ${JSON.stringify(posted.body.error ?? posted.status)}`);
// HTTP only acknowledges receipt; the socket says whether the changeset committed.
const answer = await next((m) => {
  const event = m.collaMsg;
  return [event?.csAckEvent, event?.permissionRejEvent, event?.csRejEvent, event?.csShouldRetryEvent].some((e) => e?.cs?.reqId === reqId);
});
console.log(JSON.stringify({ event: answer.collaMsg.eventID, baseRev }));
socket.close();
