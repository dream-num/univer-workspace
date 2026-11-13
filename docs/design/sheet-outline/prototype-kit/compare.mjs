import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("/tmp/sheet-lens-proto/tok/");
const { encode } = require("gpt-tokenizer/encoding/o200k_base");
const ids = Object.fromEntries(
  readFileSync("/tmp/sheet-lens-proto/ids.env", "utf8").split(/\s+/).filter(Boolean).map((kv) => kv.split("=")),
);
const OUT = "/tmp/sheet-lens-proto/out/compare";
mkdirSync(OUT, { recursive: true });
const EXEC = "/tmp/sheet-lens-proto/scripts/exec";
const wt = ["--worktree", ids.W];
const u = (unit) => ["--unit", unit, ...wt];

const tasks = [
  {
    id: "T1", unit: "sales-1000", title: "整本工作簿是什么",
    before: [{ label: "inspect workbook", args: ["inspect", "workbook", ...u(ids.K)] }],
    after: [{ label: "outline", args: ["outline", ...u(ids.K)] }],
  },
  {
    id: "T2", unit: "sales-1000", title: "Orders 表每列是什么、取值范围",
    before: [
      { label: "inspect range 前 20 行（抽样）", args: ["inspect", "range", "A1:J21", "--worksheet", "name:Orders", ...u(ids.K)], alt: "sample" },
      { label: "inspect range 全表 --json（skill 推荐的权威读法）", args: ["inspect", "range", "A1:J1001", "--worksheet", "name:Orders", "--json", ...u(ids.K)], alt: "full" },
      { label: "execute 统计脚本", args: ["execute", ...u(ids.K), "--script", `${EXEC}/orders-stats.js`], script: `${EXEC}/orders-stats.js`, alt: "exec" },
    ],
    after: [{ label: "outline --at s2.t1", args: ["outline", ...u(ids.K), "--at", "s2.t1"] }],
  },
  {
    id: "T3", unit: "sales-1000", title: "找出所有 returned 订单",
    before: [{ label: "execute 扫描脚本", args: ["execute", ...u(ids.K), "--script", `${EXEC}/orders-find.js`], script: `${EXEC}/orders-find.js` }],
    after: [{ label: "find returned", args: ["find", ...u(ids.K), "returned"] }],
  },
  {
    id: "T4", unit: "sales-1000", title: "读 Summary 的汇总块",
    before: [{ label: "inspect range A3:I8 --json", args: ["inspect", "range", "A3:I8", "--worksheet", "name:Summary", "--json", ...u(ids.K)] }],
    after: [{ label: "read Summary!A3:I8", args: ["read", ...u(ids.K), "Summary!A3:I8"] }],
  },
  {
    id: "T5", unit: "ledger-30k", title: "3 万行流水：结构与列",
    before: [
      { label: "inspect workbook", args: ["inspect", "workbook", ...u(ids.M)] },
      { label: "inspect range 前 20 行（抽样）", args: ["inspect", "range", "A1:J21", "--worksheet", "name:Ledger", ...u(ids.M)], alt: "sample" },
      { label: "execute 统计脚本", args: ["execute", ...u(ids.M), "--script", `${EXEC}/ledger-stats.js`], script: `${EXEC}/ledger-stats.js`, alt: "exec" },
    ],
    after: [
      { label: "outline", args: ["outline", ...u(ids.M)] },
      { label: "outline --at s1.t1", args: ["outline", ...u(ids.M), "--at", "s1.t1"] },
    ],
  },
  {
    id: "T6", unit: "ledger-50k", title: "5 万行流水（超过 50 万格）",
    before: [{ label: "inspect workbook", args: ["inspect", "workbook", ...u(ids.L)] }],
    after: [{ label: "outline", args: ["outline", ...u(ids.L)] }],
  },
];

const env = { ...process.env, UNIVER_HOME: "/tmp/verify-uvw-lens/lens/home" };
const MAIN = "/Users/shenweimin/.herdr/worktrees/univer-workspace/feat-refine-inspect/apps/cli/dist/main.js";

function run(args, timing, host) {
  const start = performance.now();
  const r = spawnSync("node", [MAIN, ...args, ...(timing ? ["--timing"] : [])], {
    env: host === "cli" ? { ...env, UVW_LENS_HOST: "cli" } : env, encoding: "utf8", maxBuffer: 1 << 30,
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  const exit = r.status ?? 1;
  const ms = Math.round(performance.now() - start);
  return { stdout, stderr, exit, ms };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const isLens = (args) => ["outline", "read", "find"].includes(args[0]);
const N = Number(process.env.RUNS ?? 3);

const results = [];
let errors = 0;
for (const task of tasks) {
  for (const side of ["before", "after"]) {
    for (const step of task[side]) {
      const hosts = isLens(step.args) ? ["cli", "daemon"] : [null];
      const acc = new Map(hosts.map((h) => [h, { samples: [], last: null, phases: null }]));
      for (const host of hosts) run(step.args, false, host);
      for (let i = 0; i < N; i += 1) {
        for (const host of hosts) {
          const a = acc.get(host);
          a.last = run(step.args, isLens(step.args), host);
          if (a.last.exit !== 0) errors += 1;
          a.samples.push(a.last.ms);
          const line = a.last.stderr.split("\n").find((l) => l.startsWith("timing "));
          if (line) a.phases = JSON.parse(line.slice(7));
        }
      }
      for (const host of hosts) {
        const { samples, last, phases } = acc.get(host);
        const file = `${task.id}-${side}-${step.label.replace(/[^A-Za-z0-9]+/g, "_")}.txt`;
        writeFileSync(`${OUT}/${file}`, last.stdout);
        const script = step.script ? readFileSync(step.script, "utf8") : "";
        results.push({
          task: task.id, title: task.title, unit: task.unit, side, host, label: step.label, alt: step.alt ?? null,
          command: `uvw ${step.args.join(" ").replaceAll(ids.W, "$W").replace(/--unit \S+/, "--unit $U")}`,
          exit: last.exit, chars: last.stdout.length, tokens: encode(last.stdout).length,
          scriptTokens: script ? encode(script).length : 0, script,
          wallMs: median(samples), minMs: Math.min(...samples), maxMs: Math.max(...samples), samples, phases, file,
        });
        console.log(task.id, side, host, step.label, last.exit, last.stdout.length, median(samples));
      }
    }
  }
}

const cold = [];
for (const [label, args] of [
  ["inspect workbook sales-1000", ["inspect", "workbook", ...u(ids.K)]],
  ["outline sales-1000", ["outline", ...u(ids.K)]],
  ["inspect workbook ledger-30k", ["inspect", "workbook", ...u(ids.M)]],
  ["outline ledger-30k", ["outline", ...u(ids.M)]],
  ["inspect workbook ledger-50k", ["inspect", "workbook", ...u(ids.L)]],
  ["outline ledger-50k", ["outline", ...u(ids.L)]],
]) {
  run(["daemon", "stop"], false);
  const r = run(args, isLens(args), null);
  const line = r.stderr.split("\n").find((l) => l.startsWith("timing "));
  cold.push({ label, wallMs: r.ms, exit: r.exit, phases: line ? JSON.parse(line.slice(7)) : null });
  console.log("cold", label, r.ms);
}
const startup = median([0, 1, 2].map(() => run(["--help"], false).ms));

writeFileSync(`${OUT}/results.json`, JSON.stringify({ ids: { W: ids.W }, runs: N, errors, startupMs: startup, results, cold }, null, 2));
console.log("startup", startup);
