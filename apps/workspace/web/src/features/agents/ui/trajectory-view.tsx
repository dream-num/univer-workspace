import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentSession } from "../agent.types";
import { buildTrajectory, createTrajectorySearchIndex, messageText, responseText, waterfallScale } from "../trajectory/build";
import type { Step, Turn } from "../trajectory/build";
import { expandRequests } from "../trajectory/record";
import { useAgentClient } from "./client";
import { useAgentMessages } from "./messages";
import { TrajectoryDetail } from "./trajectory-detail";
import type { TrajectorySelection } from "./trajectory-detail";
import "./trajectory.css";

function isError(step: Step) {
  return step.kind === "assistant" ? ["error", "aborted"].includes(step.call.outcome.kind) || step.rewrite : step.kind === "tool" && ["error", "denied"].includes(step.status);
}
function bounds(step: Step, now: number): [number | null, number | null] {
  return step.kind === "user" ? [step.sentAt, step.sentAt] : step.kind === "assistant" ? [Date.parse(step.call.startedAt), step.call.endedAt ? Date.parse(step.call.endedAt) : now] : [step.startedAt, step.endedAt ?? (step.status === "running" ? now : null)];
}
function Waterfall({ start, end, turn, scale, first }: { readonly start: number | null; readonly end: number | null; readonly turn: Turn; readonly scale: number; readonly first?: number | null }) {
  if (start === null || end === null) return <span />;
  return <span className="trajectory-waterfall"><i style={{ left: `${Math.max(0, (start - turn.startedAt) / scale * 100)}%`, width: `${Math.max(0.5, (end - start) / scale * 100)}%` }} />
    {first == null ? null : <b style={{ left: `${Math.min(100, Math.max(0, (first - turn.startedAt) / scale * 100))}%` }} />}</span>;
}
export function TrajectoryView({ session }: { readonly session: AgentSession }) {
  const m = useAgentMessages(); const { tr } = m;
  const client = useAgentClient();
  const query = useQuery({ queryKey: ["agent-trajectory", client.userId, session.id], queryFn: () => client.trajectory.list(session.id), refetchInterval: (query) => session.status === "running" || query.state.data?.records.some((call) => call.outcome.kind === "running") ? 1000 : false });
  const trajectory = useMemo(() => buildTrajectory(expandRequests(query.data?.records ?? []), session, query.data?.skippedRecords), [query.data, session]);
  const searchIndexFor = useMemo(() => createTrajectorySearchIndex(trajectory), [trajectory]);
  const now = Math.max(query.dataUpdatedAt, Date.now());
  const [search, setSearch] = useState(""); const [errorsOnly, setErrorsOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<{ turn: number; step: number } | "system" | null>(null);
  const selection: TrajectorySelection | null = selected === "system" ? { kind: "system" } : selected ? (() => {
    const turn = trajectory.turns.find((item) => item.index === selected.turn);
    const step = turn?.steps.find((item) => item.step === selected.step);
    return turn && step ? { kind: "step", turn, step } : null;
  })() : null;
  const term = search.trim().toLocaleLowerCase();
  const searchIndex = searchIndexFor(term);
  const matches = (step: Step) => (!errorsOnly || isError(step)) && (!term || (searchIndex?.steps.get(step) ?? "").includes(term));
  const visible = trajectory.turns.flatMap((turn) => {
    const matching = turn.steps.filter(matches);
    const parents = new Set(matching.flatMap((step) => step.kind === "tool" ? [step.parentStep] : []));
    const steps = term || errorsOnly ? turn.steps.filter((step) => matching.includes(step) || parents.has(step.step)) : turn.steps;
    return steps.length ? [{ ...turn, steps }] : [];
  });
  const systemVisible = trajectory.system && !errorsOnly && (!term || searchIndex?.system.includes(term));
  const stats = trajectory.stats;
  const statsLabels = [[tr.turns, trajectory.turns.length], [tr.calls, stats.calls], [tr.tools, stats.toolCalls], [tr.input, stats.inputTokens], [tr.output, stats.outputTokens], [m.cacheHitRate, stats.inputTokens ? `${Math.round(stats.cacheReadTokens / stats.inputTokens * 100)}%` : "—"], [tr.errors, stats.errors], [tr.rewrites, stats.rewrites], [tr.paramsChanged, stats.paramsChanged]];
  return <section className="trajectory-view" aria-label={m.trajectory}>
    <div className="trajectory-toolbar"><dl>{statsLabels.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <label><input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} /> {tr.errorsOnly}</label>
      <button type="button" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(trajectory.turns.map((turn) => turn.index)))}>{collapsed.size ? tr.expandAll : tr.collapseAll}</button>
      <input type="search" aria-label={tr.search} placeholder={tr.search} value={search} onChange={(event) => setSearch(event.target.value)} />
    </div>
    {query.error ? <p role="alert">{query.error.message}</p> : null}
    {stats.skippedRecords ? <p role="status">{tr.skipped} {stats.skippedRecords}</p> : null}
    {query.isPending ? <p role="status">{m.loading}</p> : trajectory.unrecorded ? <p role="status">{tr.unrecorded}</p> : <div className={`trajectory-body ${selection ? "trajectory-has-detail" : ""}`}>
      <div className="trajectory-tree" aria-label={m.trajectory}>
        <div className="trajectory-row trajectory-head">{[tr.span, tr.waterfall, tr.duration, tr.tokens].map((label) => <span key={label}>{label}</span>)}</div>
        {systemVisible ? <button type="button" className="trajectory-row" onClick={() => setSelected("system")}><span>SYSTEM</span><span /><span /><span /></button> : null}
        {visible.map((original) => {
          const running = original.steps.some((step) => step.kind === "assistant" && step.call.outcome.kind === "running" || step.kind === "tool" && step.status === "running");
          const scale = Math.max(1, waterfallScale(original, now));
          const turn = { ...original, endedAt: running ? Math.max(original.endedAt, now) : original.endedAt };
          return <div key={turn.index} className="trajectory-turn">
            <button type="button" className="trajectory-row trajectory-turn-row" aria-expanded={!collapsed.has(turn.index)} onClick={() => setCollapsed((prior) => { const next = new Set(prior); if (next.has(turn.index)) next.delete(turn.index); else next.add(turn.index); return next; })}>
              <span>{collapsed.has(turn.index) ? "▸" : "▾"} {tr.turn} {turn.index}</span><Waterfall start={turn.startedAt} end={turn.endedAt} turn={turn} scale={scale} /><span>{turn.endedAt - turn.startedAt} ms</span><span /></button>
            {collapsed.has(turn.index) ? null : turn.steps.map((step) => {
              const [start, end] = bounds(step, now);
              const title = step.kind === "user" ? messageText(step.message) : step.kind === "assistant" ? responseText(step.response) || `${step.call.outcome.kind === "running" ? m.running : tr.tools} ${turn.steps.filter((item) => item.kind === "tool" && item.parentStep === step.step).length}` : `${step.name} · ${step.message ? messageText(step.message) : tr.statuses[step.status]}`;
              const reason = step.kind === "assistant" ? [step.call.outcome.kind === "error" ? step.call.outcome.message : step.call.outcome.kind === "aborted" ? tr.statuses.aborted : "", step.rewrite ? tr.rewrite : "", step.unparsed ? tr.unparsed : ""].filter(Boolean).join(" · ") : step.kind === "tool" && isError(step) ? tr.statuses[step.status] : "";
              return <button type="button" key={step.step} data-step={step.step} className={`trajectory-row trajectory-${step.kind} ${isError(step) ? "trajectory-error" : ""}`} onClick={() => setSelected({ turn: turn.index, step: step.step })}>
                <span><small>{step.step}</small> {step.kind.toUpperCase()} <span>{title.split("\n")[0]?.slice(0, 160)}</span>{reason ? <em>{reason}</em> : null}</span>
                <Waterfall start={start} end={end} turn={turn} scale={scale} first={step.kind === "assistant" && step.call.performance?.timeToFirstOutputMs != null ? Date.parse(step.call.startedAt) + step.call.performance.timeToFirstOutputMs : null} />
                <span>{start === null || end === null ? "—" : `${Math.max(0, end - start)} ms`}</span><span>{step.kind === "assistant" && step.call.usage ? `${step.call.usage.inputTokens} / ${step.call.usage.outputTokens}` : "—"}</span>
              </button>;
            })}
          </div>;
        })}
        {!systemVisible && !visible.length ? <p role="status">{tr.noResults}</p> : null}
      </div>
      {selection ? <TrajectoryDetail key={selected === "system" ? "system" : `${selection.kind === "step" ? selection.turn.index + ":" + selection.step.step : ""}`} selection={selection} trajectory={trajectory} now={now} onClose={() => setSelected(null)} /> : null}
    </div>}
  </section>;
}
