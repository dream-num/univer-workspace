import argparse
import datetime
import json
import math
import statistics


def stats(values):
    values = sorted(values)
    if not values:
        return None
    return dict(n=len(values), median=statistics.median(values), min=values[0], max=values[-1],
                **({'p95': values[math.ceil(len(values) * .95) - 1]} if len(values) >= 20 else {}))


def cpu_seconds(value):
    result = 0
    for part in value.split(':'):
        result = result * 60 + float(part)
    return result


def process_samples(scenario, pid):
    result = []
    for sample in scenario['samples']:
        for line in sample['host']:
            fields = line.split(None, 5)
            if fields[0] == str(pid):
                result.append((datetime.datetime.fromisoformat(sample['at']), cpu_seconds(fields[4]), float(fields[3]) / 1024))
    return result


assert cpu_seconds('1:02.5') == 62.5
assert stats([3, 1, 2])['median'] == 2
assert stats([4, 1, 3, 2])['median'] == 2.5
assert stats(list(range(1, 21)))['p95'] == 19
parser = argparse.ArgumentParser(description='Summarize local MCP benchmark JSON without starting a stack.')
parser.add_argument('source', help='JSON saved by mcp-bench.mjs')
parser.add_argument('--markdown', action='store_true', help='Print the architecture measurement and sizing tables')
args = parser.parse_args()
with open(args.source) as file:
    source = json.load(file)
result = dict(source=args.source, completedAt=source.get('completedAt'), failure=source.get('failure'), micro={}, memory={}, writes={})
for scenario in source['scenarios']:
    if scenario['name'].startswith('memory-'):
        assert all(len([p for p in s['processes'] if p['ppid'] == 1]) == scenario['population'] for s in scenario['samples'])
        result['memory'][scenario['name']] = {k: scenario[k] for k in ['population', 'snapshots', 'errors', 'workerRssMiB', 'parentRssMiB']}
    elif 'k' not in scenario:
        result['micro'][scenario['name']] = {k: scenario[k] for k in ['attempts', 'errors', 'errorCodes', 'latencyMs', 'gatewayMs', 'workerWallMs', 'readback', 'counters']}

for same_unit in [False, True]:
    for k in sorted({s['k'] for s in source['scenarios'] if 'k' in s and s['sameUnit'] == same_unit}):
        scenarios = [s for s in source['scenarios'] if s.get('k') == k and s['sameUnit'] == same_unit]
        cpu = []; rss = []; generator = []; executor = []; gateway = []; codes = {}
        for s in scenarios:
            assert sum(x['expected'] for x in s['readback']) == s['committed'] == s['counters']['committedRevisions']
            assert all(x['expected'] == x['matched'] and not x['missing'] for x in s['readback'])
            server = process_samples(s, source['run']['SERVER_PID'])
            if len(server) > 1:
                cpu.append((server[-1][1] - server[0][1]) / (server[-1][0] - server[0][0]).total_seconds() * 100)
            rss.extend(x[2] for x in server)
            ids = [line.split()[0] for line in s['samples'][0]['host'] if line.split()[0] != str(source['run']['SERVER_PID'])]
            if ids:
                values = process_samples(s, ids[0])
                if len(values) > 1:
                    generator.append((values[-1][1] - values[0][1]) / (values[-1][0] - values[0][0]).total_seconds() * 100)
            for sample in s['samples']:
                assert not sample['competing']
                for c in sample['containers']:
                    (executor if c['Name'].endswith('-executor-1') else gateway).append(float(c['CPUPerc'].rstrip('%')))
            for code, count in s['errorCodes'].items():
                codes[code] = codes.get(code, 0) + count
        name = ('same-unit-' if same_unit else 'distinct-') + str(k)
        result['writes'][name] = dict(runs=len(scenarios), attempts=sum(s['attempts'] for s in scenarios),
            committed=sum(s['committed'] for s in scenarios), errors=sum(s['errors'] for s in scenarios), errorCodes=codes,
            writesPerSecond=stats([s['writesPerSecond'] for s in scenarios]), writesPerMinute=stats([s['writesPerMinute'] for s in scenarios]),
            latencyMs=stats([r['latencyMs'] for s in scenarios for r in s['rows']]),
            serverCPUPercent=stats(cpu), serverRssMiB=stats(rss), generatorCPUPercent=stats(generator),
            executorCPUPercent=stats(executor), gatewayCPUPercent=stats(gateway),
            readbackMatched=sum(x['matched'] for s in scenarios for x in s['readback']),
            runLoads=[dict(name=s['name'], load=s['quietCheck']['load'], at=s['quietCheck']['at']) for s in scenarios])


def spread(values, digits=1):
    return f"{values['median']:.{digits}f}，{values['min']:.{digits}f} 至 {values['max']:.{digits}f}"


def table(headers, rows):
    return '\n'.join('| ' + ' | '.join(map(str, row)) + ' |' for row in [headers, ['---'] * len(headers), *rows])


if not args.markdown:
    print(json.dumps(result, indent=2))
else:
    writes = [(name.removeprefix('distinct-'), values) for name, values in result['writes'].items() if name.startswith('distinct-')]
    tables = [table(
        ['并发 writer / Unit 数', '5 轮确认写入 / 读回数', '写入/s 中位数、范围', '写入/min 中位数、范围', '全部调用 p50 / p95（ms）', '错误数'],
        [[k, f"{w['committed']} / {w['readbackMatched']}", spread(w['writesPerSecond'], 2), spread(w['writesPerMinute']),
          f"{w['latencyMs']['median']:.1f} / {w['latencyMs']['p95']:.1f}", w['errors']] for k, w in writes])]
    tables.append(table(
        ['并发 writer', 'Server CPU 中位数、范围（%）', 'executor CPU 中位数、范围（%）', 'gateway CPU 中位数、范围（%）', '每容器 CPU 观测数'],
        [[k, spread(w['serverCPUPercent']), spread(w['executorCPUPercent']), spread(w['gatewayCPUPercent']), w['executorCPUPercent']['n']] for k, w in writes]))
    micro_rows = []
    for name, label in [('cold', '冷 worker `inspect`，每次使用新 Unit'), ('warm-inspect', '热 worker `inspect`'), ('warm-execute', '热 worker 小 `execute`')]:
        m = result['micro'][name]
        gateway = m['gatewayMs']
        p95 = f"p95 {gateway['p95']:.1f}" if 'p95' in gateway else '不足 20 次不报 p95'
        micro_rows.append([label, m['attempts'], f'{spread(gateway)}；{p95}', spread(m['workerWallMs']), m['errors']])
    tables.append(table(
        ['场景', '次数', '网关耗时中位数、范围、p95（ms）', '`worker_cpu_ms` 中位数、范围（ms）', '错误数'], micro_rows))
    memory = list(result['memory'].values())
    tables.append(table(
        ['热 worker 数', '快照数 / worker RSS 观测数', '单 worker RSS 中位数、范围（MiB）', '父进程 RSS 中位数、范围（MiB）'],
        [[m['population'], f"{m['snapshots']} / {m['workerRssMiB']['n']}", spread(m['workerRssMiB']), spread(m['parentRssMiB'])] for m in memory]))
    worker = math.ceil(max(m['workerRssMiB']['max'] for m in memory))
    parent = math.ceil(max(m['parentRssMiB']['max'] for m in memory))
    budget_rows = []
    # Planning assumptions, not measured job peaks or tested container limits.
    for gib, recommendation in [(4, '4 个，保留当前默认值'), (8, '8 个，先采用已采样的常驻数量')]:
        available = int(gib * 1024 * .75 - parent - 1024)
        budget_rows.append([f'{gib} GiB', f'`{gib * 1024} × 0.75 - {parent} - 1024 = {available}`',
                            f'`floor({available} / {worker}) = {available // worker}`', recommendation])
    tables.append(table(['executor 容器预算', 'worker 可用内存计算（MiB）', '内存估算上限', '保守建议'], budget_rows))
    print('\n\n'.join(tables))
