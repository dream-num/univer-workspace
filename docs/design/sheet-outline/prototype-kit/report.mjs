import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "/tmp/sheet-lens-proto/out/compare";
const d = JSON.parse(readFileSync(`${OUT}/results.json`, "utf8"));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MAX = 4000;
const body = (r) => {
  const t = readFileSync(`${OUT}/${r.file}`, "utf8");
  return t.length > MAX ? `${esc(t.slice(0, MAX))}\n<span class="cut">… 其余 ${(t.length - MAX).toLocaleString()} 字符未显示（共 ${t.length.toLocaleString()} 字符）</span>` : esc(t);
};
const rows = d.results;
const tasks = [...new Set(rows.map((r) => r.task))];

const card = (r) => `
<div class="card ${r.side}">
  <div class="meta"><b>${esc(r.label)}</b>${r.host ? ` <span class="tag">${r.host === "cli" ? "A1 CLI 进程" : "A2 daemon+缓存"}</span>` : ""}</div>
  <code class="cmd">${esc(r.command)}</code>
  <div class="nums"><span>输出 <b>${r.tokens.toLocaleString()}</b> tokens</span>${r.scriptTokens ? `<span>脚本 <b>${r.scriptTokens}</b> tokens</span>` : ""}<span>${r.chars.toLocaleString()} 字符</span><span>${r.wallMs} ms <small>(${r.minMs}–${r.maxMs})</small></span></div>
  ${r.phases ? `<div class="phases">${Object.entries(r.phases).map(([k, v]) => `${k}=${v}`).join(" · ")}</div>` : ""}
  ${r.script ? `<details><summary>Agent 需要写的脚本</summary><pre>${esc(r.script)}</pre></details>` : ""}
  <pre>${body(r)}</pre>
</div>`;

const OBS = {
  T1: "两者大小相近。inspect 只说哪里有数据（values/formulas/styles 的 used range），outline 说出数据是什么：Inputs 里有带名字的 KPI（TaxRate 8.0%），Orders 是 1000 行的 OrdersTbl，Summary 有标题、带合计行的表。",
  T2: "抽样的文本输出截掉了 Tax、Status 两列（… 2 columns omitted）。全表 --json 有 37.5 万 tokens，放不进上下文。Agent 自写的统计脚本里，getValues() 对带格式的 Unit Price、Amount、Tax 返回的不是 number，min/max 全是 null，需要再来一轮才能发现。outline --at 一次给出每列类型、格式、范围、去重值、公式模式、CF 和 DV。",
  T3: "find 无需写脚本，命中带显示值并给出续读命令；它也命中了 Summary!H4 的 'Returned'（不区分大小写），所以共 61 处，脚本只扫了 Orders 得到 60 处。",
  T4: "同一块数据，read 的 A1 网格比 inspect --json 少约一半 token，公式和显示值同格给出。",
  T5: "3 万行流水：outline 两步共约 700 tokens 得到全部列语义；A1 每次要把 8.7 MB UnitData 搬到 CLI 进程（export 约 1.1 s）再建模（约 0.7 s），A2 缓存命中后只剩进程启动和 resolve。",
  T6: "5 万行 × 10 列 = 500,010 格，超过 Lens 的 50 万格阈值，只输出一个 block，不做区域和列分析。这是 Lens 本身的上限。",
};
const sections = tasks.map((id) => {
  const rs = rows.filter((r) => r.task === id);
  const before = rs.filter((r) => r.side === "before");
  const after = rs.filter((r) => r.side === "after" && r.host === "daemon");
  const a1 = rs.filter((r) => r.side === "after" && r.host === "cli");
  return `
<section>
  <h2>${id} ${esc(rs[0].title)} <small>${esc(rs[0].unit)}</small></h2>
  <div class="obs">${esc(OBS[id] ?? "")}</div>
  <div class="cols">
    <div><h3>接入前</h3>${before.map(card).join("")}</div>
    <div><h3>接入后</h3>${after.map(card).join("")}
      <p class="note">A1（Lens 在 CLI 进程）输出相同，耗时：${a1.map((r) => `${esc(r.label)} ${r.wallMs} ms`).join("，")}</p></div>
  </div>
</section>`;
});

const table = rows
  .filter((r) => r.host !== "cli")
  .map((r) => `<tr><td>${r.task}</td><td>${r.side === "before" ? "前" : "后"}</td><td>${esc(r.label)}</td><td class="n">${r.tokens.toLocaleString()}</td><td class="n">${r.scriptTokens || ""}</td><td class="n">${r.wallMs}</td><td class="n">${rows.find((x) => x.task === r.task && x.label === r.label && x.host === "cli")?.wallMs ?? ""}</td></tr>`)
  .join("");
const cold = d.cold.map((c) => `<tr><td>${esc(c.label)}</td><td class="n">${c.wallMs}</td><td>${c.phases ? Object.entries(c.phases).map(([k, v]) => `${k}=${v}`).join(" · ") : ""}</td></tr>`).join("");

const html = `<!doctype html><meta charset="utf-8"><title>uvw outline 原型：接入 Lens 前后对比</title>
<style>
body{font:14px/1.5 -apple-system,system-ui,"PingFang SC",sans-serif;margin:24px;color:#1f2328;max-width:1600px}
h1{font-size:22px}h2{font-size:18px;margin-top:40px;border-bottom:1px solid #d0d7de;padding-bottom:6px}h2 small{color:#656d76;font-weight:400}
.cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.obs{background:#fff8c5;border:1px solid #d4a72c;border-radius:6px;padding:8px 12px;margin:8px 0}.card{border:1px solid #d0d7de;border-radius:6px;padding:10px;margin-bottom:12px}
.card.before{background:#fff8f5}.card.after{background:#f5fbff}.meta{margin-bottom:4px}.tag{background:#ddf4ff;border-radius:10px;padding:1px 8px;font-size:12px}
.cmd{display:block;font-size:12px;color:#57606a;word-break:break-all;margin-bottom:6px}.nums span{margin-right:14px}.phases{font-size:12px;color:#57606a;font-family:ui-monospace,monospace}
pre{background:#f6f8fa;padding:8px;overflow:auto;max-height:420px;font-size:12px;white-space:pre}.cut{color:#cf222e}
table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #d0d7de;padding:4px 8px}.n{text-align:right;font-variant-numeric:tabular-nums}.note{color:#57606a;font-size:12px}
</style>
<h1>uvw outline 原型：接入 Lens 前后对比</h1>
<p>同一 Workspace 实例、同一批 Unit。token 用 o200k_base 估算；耗时是 ${d.runs} 次运行的中位数（括号内为范围），含 uvw 进程启动约 ${d.startupMs} ms。失败次数：${d.errors}。</p>
<h2>汇总</h2>
<table><tr><th>任务</th><th></th><th>命令</th><th>输出 tokens</th><th>脚本 tokens</th><th>A2 / 前 ms</th><th>A1 ms</th></tr>${table}</table>
<h3>冷启动（daemon stop 后第一次调用）</h3>
<table><tr><th>命令</th><th>ms</th><th>阶段</th></tr>${cold}</table>
${sections.join("")}`;
mkdirSync("/tmp/sheet-lens-proto/report", { recursive: true });
writeFileSync("/tmp/sheet-lens-proto/report/index.html", html);
console.log("wrote /tmp/sheet-lens-proto/report/index.html", html.length);
