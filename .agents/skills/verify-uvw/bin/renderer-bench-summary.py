import argparse
import json
import math
import statistics

MIB = 1024 * 1024


def stats(values):
    values = sorted(v for v in values if v is not None)
    if not values:
        return None
    return dict(n=len(values), median=statistics.median(values), min=values[0], max=values[-1],
                **({'p95': values[math.ceil(len(values) * .95) - 1]} if len(values) >= 20 else {}))


def span(s, digits=0, unit=''):
    if not s:
        return 'n/a'
    f = lambda x: f'{x:.{digits}f}'
    return f'{f(s["median"])}{unit}, {f(s["min"])} to {f(s["max"])}'


def kib_mib(values):
    return stats([v / 1024 for v in values if v == v])


assert stats([3, 1, 2])['median'] == 2
assert stats(list(range(1, 21)))['p95'] == 19
assert kib_mib([1024, 2048])['median'] == 1.5
parser = argparse.ArgumentParser(description='Summarize renderer-bench.mjs JSON without starting a stack.')
parser.add_argument('source', help='JSON saved by renderer-bench.mjs')
parser.add_argument('--markdown', action='store_true', help='Print the architecture 7.1 measurement tables')
args = parser.parse_args()
with open(args.source) as file:
    src = json.load(file)
scenarios = src['scenarios']
kind = lambda k: [s for s in scenarios if s['kind'] == k]
OPS = ['screenshot-sheet', 'screenshot-doc', 'printpdf-doc', 'measure-text']
out = dict(source=args.source, completedAt=src.get('completedAt'), failure=src.get('failure'), image=src.get('image', {}).get('id'),
           host=src['host'], flags=src['flags'], inputs=src['inputs'])
loads = [q['load'][0] for q in src['quietChecks']]
out['hostLoad1m'] = dict(stats=stats(loads), busyRuns=sum(1 for q in src['quietChecks'] if q['busy']), checks=len(src['quietChecks']),
                         threshold=src['flags']['quiet-load'])
out['errors'] = dict(calls=sum(s.get('calls', 0) for s in scenarios), errors=sum(s.get('errors', 0) for s in scenarios),
                     notReal=sum(s.get('notReal', 0) for s in scenarios))

# Cold and first use: the pair's cold_start call started a runtime, the other used the prewarmed runtime on a fresh page.
cold = {}
for op in OPS:
    rows = [r for s in kind('cold') if s['op'] == op for r in s['rows']]
    ok = [r for r in rows if r['ok'] and r.get('real')]
    cold[op] = dict(runs=len([s for s in kind('cold') if s['op'] == op]), errors=len(rows) - len(ok),
                    coldRuntimeMs=stats([r['ms'] for r in ok if r['executor'] == 'cold_start']),
                    firstUseMs=stats([r['ms'] for r in ok if r['executor'] == 'warm']),
                    outputBytes=stats([r['payloadBytes'] for r in ok]), renderPages=stats([r.get('renderPages') for r in ok]))
out['cold'] = cold

# Warm: one sample per block is the block's median; the pooled figures use every call.
warm = {}
for op in OPS:
    blocks = [s for s in kind('warm') if s['op'] == op]
    rows = [r for s in blocks for r in s['rows']]
    ok = [r for r in rows if r['ok'] and r.get('real')]
    warm[op] = dict(blocks=len(blocks), errors=len(rows) - len(ok), blockMedianMs=stats([statistics.median([r['ms'] for r in s['rows'] if r['ok']]) for s in blocks if any(r['ok'] for r in s['rows'])]),
                    pooledMs=stats([r['ms'] for r in ok]), outputBytes=stats([r['payloadBytes'] for r in ok]), renderPages=stats([r.get('renderPages') for r in ok]),
                    coldAnywhere=sum(1 for r in ok if r['executor'] != 'warm'))
out['warm'] = warm

# Throughput: ops per second over the timed window, one value per run.
tp = {}
for s in kind('throughput'):
    key = f'{s["op"]}|{s["max"]}'
    entry = tp.setdefault(key, dict(op=s['op'], max=s['max'], runs=[], ))
    cpu = [float(c['CPUPerc'].rstrip('%')) for d in s['dockerSamples'] for c in d['containers'] if c['Name'].endswith('renderer-1')]
    gen = [float(c['CPUPerc'].rstrip('%')) for d in s['dockerSamples'] for c in d['containers'] if c['Name'].endswith('executor-1')]
    samples = s['memory']
    entry['runs'].append(dict(
        name=s['name'], opsPerSecond=s['completedInWindow'] / s['windowSeconds'], errors=s['errors'] + s['notReal'], calls=s['calls'],
        medianCallMs=statistics.median([r['ms'] for r in s['rows'] if r['ok']]) if any(r['ok'] for r in s['rows']) else None,
        rendererCpuPct=statistics.median(cpu) if cpu else None, rendererCpuPeakPct=max(cpu) if cpu else None, executorCpuPct=statistics.median(gen) if gen else None,
        load1m=s['quiet']['load'][0], busy=s['quiet']['busy'], restartMs=s['restartMs'],
        peakRuntimes=max(x['runtimes'] for x in samples), peakTotalRssMiB=max(x['total']['rss'] for x in samples) / 1024,
        peakTotalPssMiB=max(x['total']['pss'] for x in samples) / 1024, peakCgroupAnonMiB=max(x['cgroupAnonBytes'] for x in samples) / MIB,
        peakCgroupMiB=max(x['cgroupBytes'] for x in samples) / MIB,
        peakTreeRssMiB=max((t['rss'] for x in samples for t in x['trees']), default=0) / 1024,
        peakTreePssMiB=max((t['pss'] for x in samples for t in x['trees']), default=0) / 1024,
        peakNodeRssMiB=max(x['node']['rss'] for x in samples) / 1024,
        oomKills=max((x.get('oomKills') or 0) for x in samples), oomKilled=s.get('oomKilled'), creations=s['counters'].get('mcp_renderer_runtime_creations_total'), discards=s['counters'].get('mcp_renderer_runtime_discards_total'),
        idleAfter=[dict(runtimes=x['runtimes'], totalRssMiB=x['total']['rss'] / 1024, totalPssMiB=x['total']['pss'] / 1024, cgroupAnonMiB=x['cgroupAnonBytes'] / MIB,
                        nodeRssMiB=x['node']['rss'] / 1024, treeRssMiB=[t['rss'] / 1024 for t in x['trees']], treePssMiB=[t['pss'] / 1024 for t in x['trees']]) for x in s['idleAfter']]))
for entry in tp.values():
    runs = entry['runs']
    for field in ['opsPerSecond', 'medianCallMs', 'rendererCpuPct', 'rendererCpuPeakPct', 'executorCpuPct', 'load1m', 'peakTotalRssMiB', 'peakTotalPssMiB',
                  'peakCgroupAnonMiB', 'peakCgroupMiB', 'peakTreeRssMiB', 'peakTreePssMiB', 'peakNodeRssMiB']:
        entry[field] = stats([r[field] for r in runs])
    entry['errors'] = sum(r['errors'] for r in runs)
    entry['calls'] = sum(r['calls'] for r in runs)
    entry['busyRuns'] = sum(1 for r in runs if r['busy'])
    entry['maxLiveRuntimes'] = max(r['peakRuntimes'] for r in runs)
    entry['createdRuntimes'] = stats([r['creations'] for r in runs])
    entry['discards'] = sum(r['discards'] or 0 for r in runs)
    entry['oomKills'] = max(r['oomKills'] for r in runs)
    entry['oomKilledRuns'] = sum(1 for r in runs if r['oomKilled'])
    entry['runs'] = [dict(name=r['name'], opsPerSecond=r['opsPerSecond'], errors=r['errors']) for r in runs]
out['throughput'] = tp
ratios = {}
for op in {e['op'] for e in tp.values()}:
    sizes = sorted(e['max'] for e in tp.values() if e['op'] == op)
    for size in sizes[1:]:
        a = [r['opsPerSecond'] for r in tp[f'{op}|{sizes[0]}']['runs']]
        b = [r['opsPerSecond'] for r in tp[f'{op}|{size}']['runs']]
        ratios[f'{op}|{size}/{sizes[0]}'] = stats([y / x for x, y in zip(a, b)])
out['throughputRatios'] = ratios

# Idle memory from the cold scenarios: fresh is the prewarmed runtime before any render, used is two runtimes after one render each.
def idle(snapshots, runtimes):
    xs = [x for x in snapshots if x['runtimes'] == runtimes]
    return dict(snapshots=len(xs), nodeRssMiB=kib_mib([x['node']['rss'] for x in xs]), treeRssMiB=kib_mib([t['rss'] for x in xs for t in x['trees']]),
                treePssMiB=kib_mib([t['pss'] for x in xs for t in x['trees']]), otherChromiumRssMiB=kib_mib([x['other']['rss'] for x in xs]),
                totalRssMiB=kib_mib([x['total']['rss'] for x in xs]), totalPssMiB=kib_mib([x['total']['pss'] for x in xs]),
                cgroupAnonMiB=stats([x['cgroupAnonBytes'] / MIB for x in xs]), cgroupMiB=stats([x['cgroupBytes'] / MIB for x in xs]))
fresh = [x for s in kind('cold') for x in s['idleFresh']]
used = {op: [x for s in kind('cold') if s['op'] == op for x in s['idleUsed']] for op in OPS}
out['idle'] = dict(fresh1=idle(fresh, 1), used2={op: idle(used[op], 2) for op in OPS if used[op]})
afterLoad = {}
for s in kind('throughput'):
    afterLoad.setdefault(f'{s["op"]}|{s["max"]}', []).extend(s['idleAfter'])
out['idle']['afterLoad'] = {k: idle(v, max(x['runtimes'] for x in v)) | dict(runtimes=max(x['runtimes'] for x in v)) for k, v in afterLoad.items()}

# Soak: memory against the number of renders served by one runtime.
soak = {}
for s in kind('soak'):
    pts = []
    for p in s['points']:
        xs = p['snapshots']
        pts.append(dict(renders=p['renders'], treeRssMiB=statistics.median([t['rss'] / 1024 for x in xs for t in x['trees']]),
                        treePssMiB=statistics.median([t['pss'] / 1024 for x in xs for t in x['trees']]),
                        pageRendererRssMiB=statistics.median([x['trees'][0]['byKind'].get('renderer', {'rss': 0})['rss'] / 1024 for x in xs]),
                        nodeRssMiB=statistics.median([x['node']['rss'] / 1024 for x in xs]),
                        cgroupAnonMiB=statistics.median([x['cgroupAnonBytes'] / MIB for x in xs]),
                        cgroupMiB=statistics.median([x['cgroupBytes'] / MIB for x in xs]), chunkMedianMs=p.get('chunkMedianMs')))
    xs = [p['renders'] for p in pts]
    slope = lambda field: statistics.linear_regression(xs, [p[field] for p in pts]).slope * 100
    # The first renders fill caches and the page heap, so growth is also fitted from the third point (50 renders at the default interval) on.
    later = [p for p in pts if p['renders'] >= 2 * src['flags']['soak-every']]
    slope_later = lambda field: statistics.linear_regression([p['renders'] for p in later], [p[field] for p in later]).slope * 100 if len(later) > 2 else None
    soak[f'{s["op"]}|{s["rep"]}'] = dict(op=s['op'], rep=s['rep'], calls=s['calls'], errors=s['errors'], notReal=s['notReal'], points=pts,
                                       createdRuntimes=s['counters'].get('mcp_renderer_runtime_creations_total'), discards=s['counters'].get('mcp_renderer_runtime_discards_total'),
                                       slopeMiBPer100={f: slope(f) for f in ['treeRssMiB', 'treePssMiB', 'pageRendererRssMiB', 'nodeRssMiB', 'cgroupAnonMiB']},
                                       slopeFromWarmMiBPer100={f: slope_later(f) for f in ['treeRssMiB', 'treePssMiB', 'pageRendererRssMiB', 'nodeRssMiB', 'cgroupAnonMiB']},
                                       firstToLastMiB={f: pts[-1][f] - pts[0][f] for f in ['treeRssMiB', 'treePssMiB', 'cgroupAnonMiB']},
                                       fromWarmToLastMiB={f: pts[-1][f] - later[0][f] for f in ['treeRssMiB', 'treePssMiB', 'cgroupAnonMiB']} if later else None)
out['soak'] = soak

# End to end: the gateway event covers executor load, image inlining, staging and the renderer call.
e2e = {}
for s in kind('e2e'):
    rows = [r for r in s['rows'][2:] if not r['isError'] and r['gatewayMs'] and r['rendererMs']]
    e2e[s['unitKind']] = dict(calls=len(rows), errors=sum(1 for r in s['rows'] if r['isError']), clientMs=stats([r['ms'] for r in rows]), gatewayMs=stats([r['gatewayMs'] for r in rows]),
                              rendererMs=stats([r['rendererMs'] for r in rows]), rendererShare=stats([r['rendererMs'] / r['gatewayMs'] for r in rows]))
out['e2e'] = e2e

if not args.markdown:
    print(json.dumps(out, indent=2))
    raise SystemExit


def table(headers, rows):
    if not rows:
        return
    print('| ' + ' | '.join(headers) + ' |')
    print('| ' + ' | '.join('---' for _ in headers) + ' |')
    for row in rows:
        print('| ' + ' | '.join(str(cell) for cell in row) + ' |')
    print()


h = out['hostLoad1m']
print(f'Host load (1 min) before runs: {span(h["stats"], 1)}; {h["busyRuns"]} of {h["checks"]} runs started above the {h["threshold"]} quiet threshold. '
      f'Calls {out["errors"]["calls"]}, errors {out["errors"]["errors"]}, unreal outputs {out["errors"]["notReal"]}.\n')

rows = []
for op in OPS:
    c, w = cold[op], warm[op]
    if not (c['runs'] or w['blocks']):
        continue
    pooled, pages, size = w['pooledMs'], w['renderPages'], w['outputBytes']
    rows.append([op, f'{span(c["coldRuntimeMs"])} ({c["coldRuntimeMs"]["n"] if c["coldRuntimeMs"] else 0})', span(c['firstUseMs']),
                 f'{span(w["blockMedianMs"])} ({w["blocks"]} x {src["flags"]["warm-calls"]})' if w['blocks'] else 'n/a',
                 f'{pooled["median"]:.0f} / {pooled["p95"]:.0f}' if pooled and 'p95' in pooled else 'n/a',
                 f'{size["median"]:.0f}, {pages["median"]:.0f}' if size else 'n/a', c['errors'] + w['errors']])
if rows:
    print('Latency per operation (ms, median and range)\n')
    table(['Operation', 'Cold runtime (runs)', 'First use of prewarmed runtime', 'Warm, median of block medians', 'Warm pooled p50 / p95', 'Output bytes, pages', 'Errors'], rows)

if tp:
    print(f'Throughput, closed loop of {src["flags"]["concurrency"]} callers, {src["flags"]["seconds"]} s window (median and range of runs)\n')
    table(['Operation', 'Runtimes', 'Ops per second', 'Median call ms under load', 'Renderer container CPU %, median of run medians', 'Peak CPU % (median of runs)', 'Load generator CPU %', 'Errors / calls', 'Runtimes discarded', 'Container OOM kills', 'Runs started busy'],
          [[e['op'], e['max'], span(e['opsPerSecond'], 2), span(e['medianCallMs']), span(e['rendererCpuPct']), f'{e["rendererCpuPeakPct"]["median"]:.0f}', span(e['executorCpuPct']),
            f'{e["errors"]} / {e["calls"]}', e['discards'], e['oomKills'], e['busyRuns']] for e in sorted(tp.values(), key=lambda e: (e['op'], e['max']))])
    for key, s in sorted(ratios.items()):
        print(f'- Ops per second ratio per repeat, {key}: {span(s, 2, "x")}')
    print()

mem = []
f1 = out['idle']['fresh1']
if f1['snapshots']:
    mem.append(['Idle, prewarmed, nothing rendered', 1, span(f1['nodeRssMiB']), span(f1['treeRssMiB']), span(f1['treePssMiB']), span(f1['totalRssMiB']), span(f1['totalPssMiB']), span(f1['cgroupAnonMiB']), f1['snapshots']])
for op, u in out['idle']['used2'].items():
    if u['snapshots']:
        mem.append([f'Idle after one render per runtime, {op}', 2, span(u['nodeRssMiB']), span(u['treeRssMiB']), span(u['treePssMiB']), span(u['totalRssMiB']), span(u['totalPssMiB']), span(u['cgroupAnonMiB']), u['snapshots']])
for key, u in sorted(out['idle']['afterLoad'].items()):
    mem.append([f'Idle after a throughput run, {key.split("|")[0]}', u['runtimes'], span(u['nodeRssMiB']), span(u['treeRssMiB']), span(u['treePssMiB']), span(u['totalRssMiB']), span(u['totalPssMiB']), span(u['cgroupAnonMiB']), u['snapshots']])
for e in sorted(tp.values(), key=lambda e: (e['op'], e['max'])):
    mem.append([f'Peak sampled under load, {e["op"]}', e['max'], span(e['peakNodeRssMiB']), span(e['peakTreeRssMiB']), span(e['peakTreePssMiB']), span(e['peakTotalRssMiB']), span(e['peakTotalPssMiB']), span(e['peakCgroupAnonMiB']), e['peakTotalRssMiB']['n']])
if mem:
    print('Memory (MiB, median and range over snapshots or runs). A tree is one runtime\'s Chromium processes; the Node process is shared\n')
    table(['Moment', 'Live runtimes', 'Node RSS', 'Chromium tree RSS', 'Chromium tree PSS', 'Total RSS', 'Total PSS', 'cgroup anon', 'Snapshots or runs'], mem)

if soak:
    print('Reuse: memory against renders served by one runtime (RENDERER_MAX_RUNTIMES=1, median of 3 snapshots per point, MiB)\n')
    table(['Operation', 'Renders', 'Tree RSS', 'Tree PSS', 'Page process RSS', 'Node RSS', 'cgroup anon', 'Median call ms (chunk)'],
          [[s['op'], p['renders'], f'{p["treeRssMiB"]:.0f}', f'{p["treePssMiB"]:.0f}', f'{p["pageRendererRssMiB"]:.0f}', f'{p["nodeRssMiB"]:.0f}', f'{p["cgroupAnonMiB"]:.0f}',
            round(p['chunkMedianMs']) if p['chunkMedianMs'] else 'n/a'] for _, s in sorted(soak.items()) for p in s['points']])
    print('Linear slope per 100 renders (MiB), over all points and over the points from the third on, and run facts\n')
    fmt = lambda d, f: 'n/a' if not d or d[f] is None else f'{d[f]:.1f}'
    table(['Operation', 'Tree RSS (all / from warm)', 'Tree PSS (all / from warm)', 'Page process RSS (all / from warm)', 'Node RSS (all / from warm)', 'cgroup anon (all / from warm)', 'Errors', 'Runtimes created / discarded'],
          [[s['op']] + [f'{fmt(s["slopeMiBPer100"], f)} / {fmt(s["slopeFromWarmMiBPer100"], f)}' for f in ['treeRssMiB', 'treePssMiB', 'pageRendererRssMiB', 'nodeRssMiB', 'cgroupAnonMiB']]
           + [s['errors'] + s['notReal'], f'{s["createdRuntimes"]} / {s["discards"]}'] for _, s in sorted(soak.items())])

if e2e:
    print('Tool call against renderer time (warm, ms, median and range)\n')
    table(['Unit', 'Calls', 'Client', 'Gateway event', 'Renderer request', 'Renderer share of gateway time', 'Errors'],
          [[k, e['calls'], span(e['clientMs']), span(e['gatewayMs']), span(e['rendererMs']), span(e['rendererShare'], 2), e['errors']] for k, e in e2e.items()])
