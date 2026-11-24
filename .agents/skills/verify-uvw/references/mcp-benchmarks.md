# MCP capacity benchmarks

These measure local sizing for the executor and the renderer. They are not pass/fail journeys. Run them in an
MCP-mode instance, as [MCP mode](mcp-mode.md) describes.

## Executor capacity benchmark

Use a quiet local Docker Desktop machine. This benchmark creates draft pull requests
and Sheets in the disposable run. It verifies every reported commit through `inspect`
and saves gateway events, executor metric deltas, host counters, and process RSS.
It does not measure production capacity.

Start in a long-lived shell. Set the pool settings before `up`.

```bash
export VERIFY_UVW_ROOT=/tmp/verify-uvw-d8
export VERIFY_UVW_SERVER_PORT=3967 VERIFY_UVW_WEB_PORT=6011 VERIFY_UVW_MCP_PORT=3977
export EXECUTOR_MAX_WORKERS=16 EXECUTOR_IDLE_TTL_MS=300000
unset VERIFY_UVW_RUN
V=.agents/skills/verify-uvw/bin/verify-uvw
VERIFY_UVW_MCP=1 $V up && $V user && $V doctor
eval "$($V env)"
export EVIDENCE="$VERIFY_UVW_ROOT/$VERIFY_UVW_RUN/evidence"
mkdir -p "$EVIDENCE"
node .agents/skills/verify-uvw/bin/mcp-bench.mjs --help
node .agents/skills/verify-uvw/bin/mcp-bench.mjs --self-test
node .agents/skills/verify-uvw/bin/mcp-bench.mjs --output "$EVIDENCE/mcp-bench.json" > "$EVIDENCE/mcp-bench.stdout.json"
node .agents/skills/verify-uvw/bin/mcp-bench.mjs --scenario profile --output "$EVIDENCE/mcp-bench-profile.json" > "$EVIDENCE/mcp-bench-profile.stdout.json"
python3 .agents/skills/verify-uvw/bin/mcp-bench-summary.py "$EVIDENCE/mcp-bench.json" > "$EVIDENCE/mcp-bench-summary.json"
python3 .agents/skills/verify-uvw/bin/mcp-bench-summary.py "$EVIDENCE/mcp-bench.json" --markdown > "$EVIDENCE/mcp-bench-tables.md"
$V down
```

The Python 3 summarizer preserves the original statistics implementation. Its
`--markdown` output reproduces the five measurement and memory-budget tables in
[architecture sections 3.3 and 6.2](../../../../docs/design/workspace-mcp/architecture.zh-CN.md#33-mcp-会给-workspace-server-带来的压力)
from a complete baseline JSON. Counts are pooled, rate medians and ranges use the
five runs, p95 uses nearest rank, and display rounding happens only in Markdown.
The memory margin, job reserve, and recommended counts are planning assumptions.
Summarize an existing run without starting Docker or verify-uvw:

```bash
export EVIDENCE=/tmp/verify-uvw/<run-id>/evidence
python3 .agents/skills/verify-uvw/bin/mcp-bench-summary.py "$EVIDENCE/bench-repeat.json" --markdown
```

The default run inspects ten distinct cold Units, then makes fifty warm inspections
and fifty small writes. It samples parent and worker RSS at populations of one, two,
four, and eight workers. Five thirty-second runs at each concurrency step test distinct
Units, followed by five runs with eight writers sharing one Unit. Write targets use
a sparse 100000-row Sheet, expanded before timing, so the default row bound cannot
look like a capacity failure. Executor restarts
between populations and write runs keep earlier workers out of the sample.

The script waits up to an hour before each run if another verify stack is active or
the host's one-minute load exceeds half its logical CPU count. It records every check.
Competing-stack waits poll every two minutes. Host-only load waits poll every ten seconds.
It stops increasing writer concurrency on any error or a fivefold increase in p95.
Concurrency steps run in order, not interleaved. Record the accepted preflight
loads with any comparison; the quiet threshold does not remove background drift.
`--scenario`, `--seconds`, `--repeats`, and `--writers` support calibration runs.
Read the JSON's failure field and error counts before interpreting its rates.

End-to-end latency includes connection, tool call, and close. Gateway duration and
worker wall time are separate fields. `worker_cpu_ms` is not CPU time. RSS comes from
`/proc` inside the executor. Host `ps` includes CPU time for the Workspace process and
load generator. Container counters come from `docker stats`. The separate profile
scenario supplies system counters without treating its throughput as a reported run.

A completed benchmark requires usage events for all timed calls, a cold or warm event
as expected for each microbenchmark call, the expected live-worker population in every
RSS sample, and readback of every confirmed write. The JSON retains partial evidence
and a failure message if one of those checks fails.

## Renderer capacity benchmark

Measures the renderer role on a disposable local Docker Desktop stack: latency per operation (cold and warm), throughput against
`RENDERER_MAX_RUNTIMES`, memory per runtime, and memory growth when one runtime serves many renders. It calls the renderer RPC from inside
the executor container, so gateway, executor and Workspace time are excluded, and it recreates the renderer container (about 6 s each)
dozens of times with `verify-uvw renderer-restart <max-runtimes>`. Do not use the stack for anything else while it runs, and note the host
load it reports: it waits for quiet only when `--quiet-timeout` is set.

```bash
eval "$($V env)"
mkdir -p "$EVIDENCE/renderer-bench"
node .agents/skills/verify-uvw/bin/renderer-bench.mjs --help
node .agents/skills/verify-uvw/bin/renderer-bench.mjs --self-test
node .agents/skills/verify-uvw/bin/renderer-bench.mjs --output "$EVIDENCE/renderer-bench/renderer-bench.json"
# Tool-level comparison for the "does it matter" check: a Sheet and a Doc Unit already in a Worktree, as UNIT:WORKTREE
node .agents/skills/verify-uvw/bin/renderer-bench.mjs --scenario e2e --e2e-sheet "$SHEET_UNIT:$SHEET_WORKTREE" --e2e-doc "$DOC_UNIT:$DOC_WORKTREE" --output "$EVIDENCE/renderer-bench/renderer-bench-e2e.json"
python3 .agents/skills/verify-uvw/bin/renderer-bench-summary.py "$EVIDENCE/renderer-bench/renderer-bench.json" > "$EVIDENCE/renderer-bench/summary.json"
python3 .agents/skills/verify-uvw/bin/renderer-bench-summary.py "$EVIDENCE/renderer-bench/renderer-bench.json" --markdown > "$EVIDENCE/renderer-bench/tables.md"
```

What each scenario does, and how to read it:

- **cold.** Per operation and repeat (rotating the operation order), recreate the renderer with `RENDERER_MAX_RUNTIMES=2`, wait for its startup
  runtime, then fire two concurrent calls. The one the pool answers from the startup runtime is "first use of a prewarmed runtime" (a fresh page,
  `executor: warm`). The other starts a runtime and is the "cold runtime" figure (`executor: cold_start`), which includes Chromium launch, page load
  and the first render, while the first call runs beside it. Memory snapshots before the calls (one idle runtime, nothing rendered) and after
  (two idle runtimes) feed the idle rows.
- **warm.** After a restart and three unrecorded calls per operation, blocks of sequential calls. Operations rotate between blocks. The figure is
  the median of block medians with its range, next to the pooled p50 and p95.
- **throughput.** For each setting of `--settings` (default 1,2) and operation (screenshot of the Sheet, print of the Doc), a fresh renderer, a 4 s
  unrecorded warm-up so every runtime exists, then a closed loop of `--concurrency` callers for `--seconds`. Settings alternate order each repeat.
  Only calls that finish inside the window count. During the run a sampler inside the renderer reads `/proc` every 250 ms, and `docker stats`
  gives the renderer and the load generator (the executor container) CPU. A limiter claim needs the renderer's CPU next to the generator's.
- **soak.** One runtime (`RENDERER_MAX_RUNTIMES=1`) serves `--soak-renders` sequential renders of each of the Sheet screenshot, Doc screenshot and
  Doc print, and memory is sampled (3 snapshots, 1 s after the last call) every `--soak-every` renders. The run asserts that no second runtime was
  created, so every render reused the page. Read the series and the slope together: Chromium memory moves up and down with garbage collection,
  so a slope over few points is noise.
- **e2e.** Warm `screenshot` tool calls on one Sheet and one Doc Unit; the gateway event's `duration_ms` is joined by request ID to the renderer's
  own `duration_ms`, which shows what share of a tool call the renderer takes.

Every call is checked for real output: a screenshot must hold PNG signatures at its image offsets, a print must start with `%PDF` and report pages,
a measurement must report lines. Errors and unreal outputs are counted in the JSON and the tables. Memory columns: RSS counts a shared page in every
process that maps it, PSS splits it, and cgroup anon is what the container is charged without file cache (this kernel has no `memory.peak`, so a
peak is the largest sample). A runtime's tree is its Chromium processes; the Node process is shared by all runtimes.
Summarize an existing JSON without a stack: `python3 .agents/skills/verify-uvw/bin/renderer-bench-summary.py <json> --markdown`.
