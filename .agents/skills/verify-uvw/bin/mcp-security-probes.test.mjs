import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  browserTrees, classifyMg2, classifyMg4, classifyMg5, classifyMg8, classifyMg9, classifyMg10, classifyMg11, classifyReclaim,
  extraMounts, parseOnly, sensitiveNames, servedBy, suspectMounts,
} from './mcp-security-probes.mjs';

test('sensitive names match the Stage G patterns and nothing else', () => {
  assert.deepEqual(sensitiveNames(['PATH', 'MCP_EXECUTOR_TOKEN', 'MCP_RENDERER_TOKEN', 'UNIVER_LICENSE', 'UNIVER_LICENSE_KEY', 'X_SECRET', 'API_KEY', 'NODE_ENV', 'KEYBOARD', 'TOKEN_COUNT']),
    ['API_KEY', 'MCP_EXECUTOR_TOKEN', 'MCP_RENDERER_TOKEN', 'UNIVER_LICENSE', 'UNIVER_LICENSE_KEY', 'X_SECRET']);
  assert.equal(classifyMg2({ processes: { a: ['NODE_ENV'], b: [] } }).result, 'contained');
  assert.equal(classifyMg2({ processes: { a: ['NODE_ENV'], b: ['MCP_EXECUTOR_TOKEN'] } }).result, 'exposed');
});
test('--only keeps probe order and rejects reserved or unknown ids', () => {
  assert.deepEqual(parseOnly('mg7, MG6'), ['MG6', 'MG7']);
  assert.equal(parseOnly(undefined).length, 9);
  for (const bad of ['MG1', 'MG3', 'MG12', '']) assert.throws(() => parseOnly(bad));
});
test('network, isolation and reclamation verdicts', () => {
  assert.equal(classifyMg4({ targets: { a: 'unreachable', b: 'unreachable' } }).result, 'contained');
  assert.equal(classifyMg4({ targets: { a: 'unreachable', b: 'reachable' } }).result, 'exposed');
  assert.equal(classifyMg5({ otherWorkers: 0, bPidVisible: false, markerSeen: false }).result, 'contained');
  assert.equal(classifyMg5({ otherWorkers: 0, bPidVisible: false, markerSeen: true }).result, 'exposed');
  assert.equal(classifyReclaim({ bOk: true, reclaimed: true, what: 'x' }).result, 'contained');
  for (const bad of [{ bOk: false }, { reclaimed: false }, { survived: false }, { stopped: false }]) {
    assert.equal(classifyReclaim({ bOk: true, reclaimed: true, what: 'x', ...bad }).result, 'exposed');
  }
  assert.equal(classifyMg8({ bOk: true }).result, 'contained');
  assert.equal(classifyMg8({ bOk: false }).result, 'exposed');
});
const standard = `22 1 0:21 / / rw - overlay overlay rw
23 22 0:22 / /proc rw - proc proc rw
24 22 0:23 / /dev rw - tmpfs tmpfs rw
25 22 8:1 /var/lib/docker/containers/x/hosts /etc/hosts rw - ext4 /dev/vda1 rw
26 23 0:22 /sys /proc/sys ro - proc proc rw`;
const withStaging = `${standard}\n40 22 0:40 /tmp/verify-uvw/run/staging /staging rw - fakeowner fakeowner rw`;
test('mount classification ignores standard container mounts and flags staging or data', () => {
  assert.deepEqual(extraMounts(standard), []);
  assert.deepEqual(suspectMounts(withStaging).map(m => m.mountpoint), ['/staging']);
  assert.deepEqual(suspectMounts(`${standard}\n41 22 0:41 /srv/ws/data /mnt/x rw - ext4 d rw`).map(m => m.mountpoint), ['/mnt/x']);
  assert.equal(classifyMg9({ places: { executor: standard, renderer: standard } }).result, 'contained');
  assert.equal(classifyMg9({ places: { executor: standard, renderer: withStaging } }).result, 'exposed');
  assert.equal(classifyMg9({ places: { executor: standard, renderer: null } }).result, 'inconclusive');
});
test('MG10 is contained only when both roles refuse', () => {
  const refused = { outcome: 'refused' }, healthy = { outcome: 'healthy' };
  assert.equal(classifyMg10({ executor: refused, renderer: refused }).result, 'contained');
  assert.equal(classifyMg10({ executor: refused, renderer: healthy }).result, 'exposed');
  assert.equal(classifyMg10({ executor: { outcome: 'never healthy within 30 s' }, renderer: refused }).result, 'contained');
});
const proc = (pid, ppid, cmd, ticks) => ({ pid, ppid, cmd, ticks });
const chrome = '/usr/lib/chromium/chromium';
test('browser trees ignore crashpad handlers and group children under their browser', () => {
  const procs = [proc(1, 0, 'node', 5), proc(31, 1, chrome, 10), proc(59, 1, '/usr/lib/chromium/chrome_crashpad_handler', 1),
    proc(65, 31, `${chrome} --type=zygote`, 2), proc(153, 65, `${chrome} --type=renderer`, 7), proc(40, 1, chrome, 3)];
  const trees = browserTrees(procs);
  assert.deepEqual(Object.keys(trees).sort(), ['31', '40']);
  assert.equal(trees['31'].ticks, 19);
  assert.deepEqual(trees['31'].pids.sort((a, b) => a - b), [31, 65, 153]);
});
test('servedBy picks the tree whose CPU rose and MG11 compares users', () => {
  const before = { 31: { ticks: 10 }, 40: { ticks: 3 } };
  assert.equal(servedBy(before, { 31: { ticks: 10 }, 40: { ticks: 30 } }).root, '40');
  assert.equal(servedBy(before, before).root, undefined);
  assert.equal(classifyMg11({ a: '31', b: '31', browsers: 2 }).result, 'exposed');
  assert.equal(classifyMg11({ a: '31', b: '40', browsers: 2 }).result, 'contained');
  assert.equal(classifyMg11({ a: undefined, b: '40', browsers: 2 }).result, 'inconclusive');
});
