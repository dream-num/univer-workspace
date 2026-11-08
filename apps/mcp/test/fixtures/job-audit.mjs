import net from 'node:net';
import { tsImport } from 'tsx/esm/api';
let connections = 0;
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  connections += 1;
  return connect.apply(this, args);
};
const send = process.send.bind(process);
process.send = (reply, ...args) => {
  if (reply.ok && !(reply.value instanceof Uint8Array))
    reply.value._audit = { env: process.env, connections, cwd: process.cwd() };
  return send(reply, ...args);
};
await tsImport('../../src/executor/jobs/entry.ts', import.meta.url);
