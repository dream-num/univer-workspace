#!/usr/bin/env node
// node preview.mjs page.univer.html [--workspace <origin>] [--repo <owner/slug> --pr <n>] [--open] [--wait <seconds>] [--self-check]
import { createServer, request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { watchFile, unwatchFile } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, resolve } from 'node:path';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 2)) throw new Error('Node 18.2 or newer is required.');
const out = (value) => console.log(JSON.stringify(value));

function start({ path, workspace, wait = 0, open = false, source }) {
  const origin = new URL(workspace).origin;
  const token = 't' + randomBytes(16).toString('hex');
  const clients = new Set();
  let report = '';
  let seen = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const port = server.address().port;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    const bad = ![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host) ||
      (req.headers.origin && req.headers.origin !== origin) || url.searchParams.get('token') !== token;
    // Refusals carry the CORS headers too, so the Workspace page can tell a refusal from a blocked connection.
    if (bad) return res.writeHead(403).end('Refused');
    const route = `${req.method} ${url.pathname}`;
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    if (route === 'GET /page') {
      seen = true;
      try {
        return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': 'sandbox' }).end(await readFile(path));
      } catch { return res.writeHead(503).end('Save the file and retry.'); }
    }
    if (route === 'GET /events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': ok\n\n');
      clients.add(res);
      return req.on('close', () => clients.delete(res));
    }
    if (route === 'GET /report') return report ? res.writeHead(200, { 'Content-Type': 'application/json' }).end(report) : res.writeHead(204).end();
    if (route === 'POST /report') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; if (body.length > 1e6) req.destroy(); });
      return req.on('end', () => {
        try { out({ event: 'report', ...JSON.parse(body) }); report = body; res.writeHead(204).end(); } catch { res.writeHead(400).end(); }
      });
    }
    res.writeHead(404).end();
  });
  watchFile(path, { interval: 100 }, (now, before) => {
    if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) for (const client of clients) client.write(`event: change\ndata: ${Date.now()}\n\n`);
  });
  const timers = [setInterval(() => { for (const client of clients) client.write(': ping\n\n'); }, 15000)];
  const stop = () => { timers.forEach(clearInterval); unwatchFile(path); clients.forEach((client) => client.end()); server.close(); server.closeAllConnections(); };
  return new Promise((done) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const link = new URL('/html-view-preview', origin);
    link.searchParams.set('src', `${base}/page`);
    link.searchParams.set('token', token);
    link.searchParams.set('file', basename(path));
    if (source) { link.searchParams.set('repo', source.repo); link.searchParams.set('pr', source.pr); }
    if (wait > 0) timers.push(setTimeout(() => { if (!seen) out({ event: 'waiting', seconds: wait }); }, wait * 1000));
    if (open) {
      const [cmd, ...args] = process.platform === 'darwin' ? ['open', link.href] : process.platform === 'win32'
        ? ['rundll32', 'url.dll,FileProtocolHandler', link.href] : ['xdg-open', link.href];
      spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    }
    done({ base, token, url: link.href, stop });
  }));
}

async function selfCheck() {
  const ok = (cond, message) => { if (!cond) throw new Error(`self-check failed: ${message}`); };
  const origin = 'https://space.example';
  const preview = await start({ path: resolve(process.argv[1]), workspace: origin });
  const get = (path, headers = {}) => fetch(preview.base + path, { headers, redirect: 'manual' });
  const mine = `?token=${preview.token}`;
  ok((await get('/page' + mine, { Origin: origin })).status === 200, 'file with token and Origin');
  ok((await get('/page')).status === 403, 'missing token');
  ok((await get('/page?token=x', { Origin: origin })).status === 403, 'wrong token');
  ok((await get('/page' + mine, { Origin: 'https://evil.example' })).status === 403, 'wrong Origin');
  ok((await get('/other' + mine)).status === 404, 'other path');
  ok((await get('/nothing')).status === 403, 'wrong token on other path');
  const rebind = await new Promise((done) => request(preview.base + '/page' + mine, { headers: { Host: 'example.com' } }, (res) => done(res.statusCode)).end());
  ok(rebind === 403, 'wrong Host');
  ok((await get('/report' + mine)).status === 204, 'no report yet');
  preview.stop();
  console.log('self-check ok');
}

const opts = {};
const rest = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (['--open', '--self-check'].includes(args[i])) opts[args[i]] = true;
  else if (['--workspace', '--wait', '--repo', '--pr'].includes(args[i])) opts[args[i]] = args[++i];
  else rest.push(args[i]);
}
const workspace = opts['--workspace'] || 'https://space.univer.ai';
const wait = Number(opts['--wait'] ?? 30);
if (opts['--self-check']) await selfCheck();
else {
  const [file] = rest;
  const { '--repo': repo, '--pr': pr } = opts;
  if (!file || rest.length > 1 || !(wait >= 0) || (repo === undefined) !== (pr === undefined) ||
      (repo !== undefined && (!/^[^/\s]+\/[^/\s]+$/.test(repo) || !/^[1-9]\d*$/.test(pr))))
    throw new Error('Usage: node preview.mjs page.html [--workspace <origin>] [--repo <owner/slug> --pr <n>] [--open] [--wait <seconds>]');
  const path = resolve(file);
  await readFile(path);
  const preview = await start({ path, workspace, wait, open: opts['--open'], source: repo ? { repo, pr } : undefined });
  out({ event: 'ready', url: preview.url, file: path, token: preview.token });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, preview.stop);
}
