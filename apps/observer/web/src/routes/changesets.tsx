import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  type ActivityTotals,
  type ChangesetActivity,
  Metric,
  ObservationCard,
  ObservationShell,
  observationRequest,
} from "../features/observation";
import { PageHeading } from "./index";

type Measure = "changesetCount" | "mutationCount" | "mutationSize";
type Scope = "all" | "trunk" | "worktree";
type Range = "15m" | "1h" | "6h" | "24h" | "7d" | "30d" | "custom";

export const Route = createFileRoute("/changesets")({
  validateSearch: (search: Record<string, unknown>) => ({
    measure: validMeasure(search.measure),
    scope: validScope(search.scope),
    range: validRange(search.range),
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
    userId: typeof search.userId === "string" ? search.userId : "",
    unitId: typeof search.unitId === "string" ? search.unitId : "",
    auto: search.auto !== false && search.auto !== "false",
  }),
  component: ChangesetPage,
});

function ChangesetPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const activity = useQuery({
    queryKey: ["observation", "changesets", search],
    queryFn: () => {
      const range = queryRange({
        range: search.range,
        ...(search.from ? { from: search.from } : {}),
        ...(search.to ? { to: search.to } : {}),
      });
      const params = new URLSearchParams({
        from: new Date(range.from).toISOString(),
        to: new Date(range.to).toISOString(),
        scope: search.scope,
        measure: search.measure,
      });
      if (search.userId.trim()) params.set("userId", search.userId.trim());
      if (search.unitId.trim()) params.set("unitId", search.unitId.trim());
      return observationRequest<ChangesetActivity>(`/api/changesets?${params}`);
    },
    refetchInterval: search.auto ? 30_000 : false,
  });
  const filterOptions = useQuery({
    queryKey: ["observation", "filter-options"],
    queryFn: () => observationRequest<{
      readonly users: readonly { readonly id: string; readonly username: string; readonly displayName: string }[];
      readonly units: readonly { readonly id: string; readonly name: string; readonly spaceName: string; readonly unitType: string }[];
    }>("/api/filter-options"),
    staleTime: 60_000,
  });
  const setSearch = (patch: Partial<typeof search>) =>
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });

  return (
    <ObservationShell>
      <PageHeading title="Changeset 活动" description="直接查询 Collaboration SQLite；筛选条件保存在 URL 中。" />
      <ObservationCard className="mb-5">
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_1.2fr_1.2fr_auto]">
          <Control label="度量">
            <select value={search.measure} onChange={(event) => setSearch({ measure: event.target.value as Measure })} className={inputClass}>
              <option value="changesetCount">Changeset Count</option>
              <option value="mutationCount">Mutation Count</option>
              <option value="mutationSize">Mutation Size</option>
            </select>
          </Control>
          <Control label="范围">
            <select value={search.range} onChange={(event) => setSearch({ range: event.target.value as Range })} className={inputClass}>
              <option value="15m">最近 15 分钟</option><option value="1h">最近 1 小时</option><option value="6h">最近 6 小时</option>
              <option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option><option value="custom">自定义</option>
            </select>
          </Control>
          <Control label="Scope">
            <select value={search.scope} onChange={(event) => setSearch({ scope: event.target.value as Scope })} className={inputClass}>
              <option value="all">全部</option><option value="trunk">Trunk</option><option value="worktree">Worktree</option>
            </select>
          </Control>
          <Control label="Workspace User ID">
            <input list="observation-users" value={search.userId} onChange={(event) => setSearch({ userId: event.target.value })} placeholder="选择或输入 ID" className={inputClass} />
            <datalist id="observation-users">{filterOptions.data?.users.map((user) => <option key={user.id} value={user.id}>{user.displayName} (@{user.username})</option>)}</datalist>
          </Control>
          <Control label="Unit ID">
            <input list="observation-units" value={search.unitId} onChange={(event) => setSearch({ unitId: event.target.value })} placeholder="选择或输入 ID" className={inputClass} />
            <datalist id="observation-units">{filterOptions.data?.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} · {unit.spaceName} ({unit.unitType})</option>)}</datalist>
          </Control>
          <label className="flex items-end gap-2 pb-2 text-xs text-slate-400"><input type="checkbox" checked={search.auto} onChange={(event) => setSearch({ auto: event.target.checked })} />30 秒刷新</label>
        </div>
        {search.range === "custom" ? <div className="mt-4 grid max-w-2xl grid-cols-2 gap-4">
          <Control label="开始时间"><input type="datetime-local" value={toLocalInput(search.from)} onChange={(event) => setSearch({ from: fromLocalInput(event.target.value) })} className={inputClass} /></Control>
          <Control label="结束时间"><input type="datetime-local" value={toLocalInput(search.to)} onChange={(event) => setSearch({ to: fromLocalInput(event.target.value) })} className={inputClass} /></Control>
        </div> : null}
      </ObservationCard>

      {activity.isError ? <ObservationCard><p className="text-red-300">{activity.error.message}</p></ObservationCard> : null}
      {activity.isLoading ? <ObservationCard><p className="text-slate-500">正在查询 Collaboration 数据库…</p></ObservationCard> : null}
      {activity.data ? <ActivityView activity={activity.data} measure={search.measure} /> : null}
    </ObservationShell>
  );
}

function ActivityView({ activity, measure }: { readonly activity: ChangesetActivity; readonly measure: Measure }) {
  const values = activity.buckets.map((bucket) => bucket[measure]);
  const peak = Math.max(0, ...values);
  const average = activity.buckets.length ? activity.totals[measure] / activity.buckets.length : 0;
  const coverageTotal = activity.mutationSizePresentCount + activity.mutationSizeMissingCount;
  const coverage = coverageTotal ? activity.mutationSizePresentCount / coverageTotal : 1;
  return <>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <ObservationCard><Metric label="总量" value={formatMeasure(activity.totals[measure], measure)} /></ObservationCard>
      <ObservationCard><Metric label="平均每桶" value={formatMeasure(average, measure)} hint={`桶宽 ${formatDuration(activity.bucketMs)}`} /></ObservationCard>
      <ObservationCard><Metric label="峰值桶" value={formatMeasure(peak, measure)} /></ObservationCard>
      <ObservationCard><Metric label="Mutation Size 覆盖率" value={`${(coverage * 100).toFixed(1)}%`} hint={`${activity.mutationSizeMissingCount} 条缺失；${activity.missingCreateTimeCount} 条缺少时间`} /></ObservationCard>
    </div>
    <ObservationCard title={`${measureLabel(measure)} 频率`} className="mt-5">
      <ActivityChart values={values} labels={activity.buckets.map((bucket) => bucket.start)} />
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/10 pt-3 text-xs text-slate-500">
        <span>Collaboration 查询 {activity.meta.collaborationQueryMs.toFixed(2)} ms</span>
        <span>产品补全 {activity.meta.productEnrichmentMs.toFixed(2)} ms</span>
        <span>服务端总耗时 {activity.meta.totalServerMs.toFixed(2)} ms</span>
        <span>生成于 {new Date(activity.meta.generatedAt).toLocaleString()}</span>
        <span>最新 Changeset {activity.meta.latestChangesetTime ? new Date(activity.meta.latestChangesetTime).toLocaleString() : "无"}</span>
      </div>
    </ObservationCard>
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <RankTable title="Workspace User 排行" rows={activity.users} measure={measure} label={(row) => row.displayName ?? row.username ?? row.id} />
      <RankTable title="Unit 排行" rows={activity.units} measure={measure} label={(row) => row.name ? `${row.name}${row.spaceName ? ` · ${row.spaceName}` : ""}` : row.id} />
    </div>
  </>;
}

function ActivityChart({ values, labels }: { readonly values: readonly number[]; readonly labels: readonly number[] }) {
  const width = 1000, height = 240, pad = 18;
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? pad : pad + index * (width - pad * 2) / (values.length - 1);
    const y = height - pad - value / max * (height - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  return <div className="overflow-hidden"><svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full" role="img" aria-label="Changeset 活动趋势">
    <defs><linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b82f6" stopOpacity=".35"/><stop offset="1" stopColor="#3b82f6" stopOpacity="0"/></linearGradient></defs>
    {[0.25, 0.5, 0.75, 1].map((ratio) => <line key={ratio} x1={pad} x2={width-pad} y1={height-pad-ratio*(height-pad*2)} y2={height-pad-ratio*(height-pad*2)} stroke="rgba(255,255,255,.07)" />)}
    {points ? <><polygon points={`${pad},${height-pad} ${points} ${width-pad},${height-pad}`} fill="url(#activity-fill)"/><polyline points={points} fill="none" stroke="#60a5fa" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/></> : null}
  </svg><div className="flex justify-between text-[11px] text-slate-600"><span>{labels[0] ? new Date(labels[0]).toLocaleString() : ""}</span><span>{labels.at(-1) ? new Date(labels.at(-1)!).toLocaleString() : ""}</span></div></div>;
}

function RankTable<T extends ActivityTotals & { readonly id: string }>({ title, rows, measure, label }: { readonly title: string; readonly rows: readonly T[]; readonly measure: Measure; readonly label: (row: T) => string }) {
  return <ObservationCard title={title}>{rows.length === 0 ? <p className="text-sm text-slate-500">当前筛选范围没有数据。</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-500"><tr><th className="pb-3 font-medium">名称</th><th className="pb-3 text-right font-medium">Changeset</th><th className="pb-3 text-right font-medium">Mutation</th><th className="pb-3 text-right font-medium">Size</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-white/5"><td className="max-w-64 truncate py-3 text-slate-300" title={row.id}>{label(row)}</td><td className={cellClass(measure === "changesetCount")}>{row.changesetCount}</td><td className={cellClass(measure === "mutationCount")}>{row.mutationCount}</td><td className={cellClass(measure === "mutationSize")}>{formatMeasure(row.mutationSize, "mutationSize")}</td></tr>)}</tbody></table></div>}</ObservationCard>;
}

function Control({ label, children }: { readonly label: string; readonly children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs text-slate-500">{label}</span>{children}</label>; }
const inputClass = "w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500";
const cellClass = (active: boolean) => `py-3 text-right tabular-nums ${active ? "font-medium text-blue-300" : "text-slate-500"}`;
function measureLabel(value: Measure) { return value === "changesetCount" ? "Changeset Count" : value === "mutationCount" ? "Mutation Count" : "Mutation Size"; }
function formatMeasure(value: number, measure: Measure): string { return measure === "mutationSize" ? formatBytes(value) : Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2); }
function formatBytes(value: number): string { if (value < 1024) return `${Math.round(value)} B`; if (value < 1024 ** 2) return `${(value/1024).toFixed(1)} KiB`; return `${(value/1024**2).toFixed(1)} MiB`; }
function formatDuration(value: number): string { if (value < 3600000) return `${value/60000} 分钟`; return `${value/3600000} 小时`; }
function validMeasure(value: unknown): Measure { return value === "mutationCount" || value === "mutationSize" ? value : "changesetCount"; }
function validScope(value: unknown): Scope { return value === "trunk" || value === "worktree" ? value : "all"; }
function validRange(value: unknown): Range { return value === "15m" || value === "6h" || value === "24h" || value === "7d" || value === "30d" || value === "custom" ? value : "1h"; }
function queryRange(search: { readonly range: Range; readonly from?: string; readonly to?: string }) { const to = search.range === "custom" && search.to ? Date.parse(search.to) : Date.now(); const duration = { "15m": 900000, "1h": 3600000, "6h": 21600000, "24h": 86400000, "7d": 604800000, "30d": 2592000000, custom: 3600000 }[search.range]; const from = search.range === "custom" && search.from ? Date.parse(search.from) : to-duration; return { from: Number.isFinite(from) ? from : to-3600000, to: Number.isFinite(to) ? to : Date.now() }; }
function toLocalInput(value?: string): string { if (!value) return ""; const date = new Date(value); if (Number.isNaN(date.valueOf())) return ""; return new Date(date.valueOf()-date.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function fromLocalInput(value: string): string | undefined { const time = new Date(value).valueOf(); return Number.isNaN(time) ? undefined : new Date(time).toISOString(); }
