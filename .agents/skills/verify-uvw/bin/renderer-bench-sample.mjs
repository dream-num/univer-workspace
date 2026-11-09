#!/usr/bin/env node
// Runs inside the renderer container: node --input-type=module -e "$(cat renderer-bench-sample.mjs)" <intervalMs>
// Prints one JSON line per sample until stdin closes. Memory comes from /proc: VmRSS counts shared pages in every process
// that maps them, Pss splits them, and the cgroup figures are what the container is charged (anon excludes file cache; this kernel
// has no memory.peak, so a peak is the largest sample). Processes are grouped into one tree per
// Chromium (a runtime owns one), so a tree plus the shared Node process is the memory of the runtimes it holds.
import { readdirSync, readFileSync } from 'node:fs';

const interval = Number(process.argv[1] ?? 500);
const read = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
const kib = (text, key) => Number(text?.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? NaN);

function snapshot() {
  const procs = new Map();
  for (const pid of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    const status = read(`/proc/${pid}/status`);
    const cmd = read(`/proc/${pid}/cmdline`)?.replaceAll('\0', ' ');
    if (!status || !cmd) continue;
    const crashpad = cmd.startsWith('/usr/lib/chromium/chrome_crashpad_handler');
    const isChromium = cmd.startsWith('/usr/lib/chromium/chromium') || crashpad;
    const isNode = Number(pid) === 1;
    if (!isChromium && !isNode) continue;
    procs.set(Number(pid), {
      pid: Number(pid), ppid: kib(status, 'PPid'), rss: kib(status, 'VmRSS'), pss: kib(read(`/proc/${pid}/smaps_rollup`), 'Pss'),
      kind: isNode ? 'node' : crashpad ? 'crashpad' : cmd.match(/--type=([a-z-]+)/)?.[1] ?? 'browser',
    });
  }
  const add = (sum, p) => { sum.rss += p.rss; sum.pss += p.pss; sum.count++; return sum; };
  const zero = () => ({ rss: 0, pss: 0, count: 0 });
  const rootOf = (p) => { for (let q = p; q; q = procs.get(q.ppid)) if (q.kind === 'browser') return q; return null; };
  const trees = new Map(); const other = zero(); let node = zero();
  for (const p of procs.values()) {
    if (p.kind === 'node') { node = add(zero(), p); continue; }
    const root = rootOf(p);
    if (!root) { add(other, p); continue; }
    const tree = trees.get(root.pid) ?? { pid: root.pid, ...zero(), byKind: {} };
    add(tree, p); add(tree.byKind[p.kind] ??= zero(), p); trees.set(root.pid, tree);
  }
  const stat = read('/sys/fs/cgroup/memory.stat');
  const all = [node, other, ...trees.values()];
  return {
    t: Date.now(), node, other, trees: [...trees.values()], runtimes: trees.size,
    total: { rss: all.reduce((n, x) => n + x.rss, 0), pss: all.reduce((n, x) => n + x.pss, 0) },
    cgroupBytes: Number(read('/sys/fs/cgroup/memory.current')?.trim() ?? NaN), cgroupAnonBytes: Number(stat?.match(/^anon (\d+)/m)?.[1] ?? NaN),
    oomKills: Number(read('/sys/fs/cgroup/memory.events')?.match(/^oom_kill (\d+)/m)?.[1] ?? NaN),
  };
}

let open = true;
process.stdin.on('data', () => {});
process.stdin.on('end', () => { open = false; });
while (open) {
  console.log(JSON.stringify(snapshot()));
  await new Promise((resolve) => setTimeout(resolve, interval));
}
