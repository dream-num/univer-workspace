import { useState, type ReactNode } from "react";
import type { AssistantStep, Step, Trajectory, Turn, WireMessage } from "../trajectory/build";
import { contextMessageChange, messageText } from "../trajectory/build";
import { CopyValue, JsonView, LongText } from "./json-view";
import { useAgentMessages } from "./messages";

export type TrajectorySelection = { kind: "system" } | { kind: "step"; turn: Turn; step: Step };
export function CacheUsage({ inputTokens, cacheReadTokens }: { readonly inputTokens: number; readonly cacheReadTokens: number }) {
  const m = useAgentMessages();
  return <div><p>{m.tr.input} {inputTokens} · {m.tr.hit} {cacheReadTokens} · {m.tr.miss} {inputTokens - cacheReadTokens}</p>
    <meter min={0} max={Math.max(inputTokens, 1)} value={cacheReadTokens} aria-label={m.cacheHitRate} /> {inputTokens ? Math.round(cacheReadTokens / inputTokens * 100) : 0}%</div>;
}
function AsSent({ message, reminders }: { readonly message: WireMessage; readonly reminders: Extract<Step, { kind: "user" }>["reminders"] }) {
  const { tr } = useAgentMessages();
  const parts = typeof message.content === "string" ? [{ text: message.content, part: null }] : (message.content ?? []).map((part, index) => ({ text: part.text, part: index }));
  return <>{parts.map(({ text, part }, index) => {
    if (text === undefined) return <JsonView key={index} value={Array.isArray(message.content) ? message.content[index] : null} />;
    const spans = reminders.filter((span) => span.part === part);
    let cursor = 0;
    return <div key={index}>{spans.map((span) => {
      const before = text.slice(cursor, span.start); cursor = span.end;
      return <div key={span.start}><LongText text={before} /><div className="trajectory-reminder"><small>{tr.sources[span.source]}</small><LongText text={text.slice(span.start, span.end)} /></div></div>;
    })}<LongText text={text.slice(cursor)} /></div>;
  })}</>;
}
function ContextSent({ step }: { readonly step: AssistantStep }) {
  const { tr } = useAgentMessages();
  return <><CacheUsage inputTokens={step.call.usage?.inputTokens ?? 0} cacheReadTokens={step.call.usage?.cacheReadTokens ?? 0} />
    <CopyValue request text={step.request.body} />
    {step.messages?.map((message, index) => <details key={index} className="trajectory-context-message"><summary>{message.role.toUpperCase()} · {messageText(message).split("\n")[0]?.slice(0, 100)} · {new Blob([JSON.stringify(message)]).size} B {index >= step.newFrom ? contextMessageChange(step, index) === "rewritten" ? tr.rewritten : tr.new : ""}</summary><JsonView value={message} /></details>)}
    <JsonView value={step.request.request} raw={step.request.body} />
  </>;
}
export function TrajectoryDetail({ selection, trajectory, now, onClose }: { readonly selection: TrajectorySelection; readonly trajectory: Trajectory; readonly now: number; readonly onClose: () => void }) {
  const { tr } = useAgentMessages();
  const [tab, setTab] = useState(0);
  let title: string;
  let tabs: { label: string; content: ReactNode }[];
  if (selection.kind === "system") {
    title = "SYSTEM";
    tabs = [{ label: tr.system, content: <LongText text={trajectory.system ? messageText(trajectory.system.message) : ""} /> },
      { label: tr.toolsTab, content: <JsonView value={trajectory.system?.tools} /> }, { label: tr.params, content: <JsonView value={trajectory.system?.params} /> }];
  } else {
    const { step, turn } = selection;
    const start = step.kind === "user" ? step.sentAt : step.kind === "assistant" ? Date.parse(step.call.startedAt) : step.startedAt;
    const end = step.kind === "user" ? start : step.kind === "assistant" ? Date.parse(step.call.endedAt ?? new Date(now).toISOString()) : step.endedAt ?? now;
    title = `${step.kind.toUpperCase()} · ${tr.turn} ${turn.index} · ${tr.step} ${step.step} · ${start === null ? "—" : `${Math.max(0, (end ?? now) - start)} ms`}`;
    if (step.kind === "user") tabs = [{ label: tr.asSent, content: <AsSent message={step.message} reminders={step.reminders} /> }, { label: tr.raw, content: <JsonView value={step.message} /> }];
    else if (step.kind === "assistant") {
      if (step.unparsed) tabs = [{ label: tr.raw, content: <><p>{tr.unparsed}</p><CopyValue request text={step.request.body} /><LongText text={step.request.body} /></> }];
      else tabs = [
        { label: tr.response, content: <JsonView value={step.response} /> }, { label: tr.context, content: <ContextSent step={step} /> },
        { label: tr.replay, content: step.replay ? <><p>{step.replayMismatch ? tr.mismatch : ""}</p><JsonView value={step.replay} /></> : tr.noReplay },
        { label: tr.usage, content: <><dl><dt>{tr.started}</dt><dd>{step.call.startedAt}</dd><dt>{tr.firstOutput}</dt><dd>{step.call.performance?.timeToFirstOutputMs == null ? tr.unavailable : new Date(Date.parse(step.call.startedAt) + step.call.performance.timeToFirstOutputMs).toISOString()}</dd><dt>{tr.duration}</dt><dd>{step.call.performance?.responseTimeMs ?? ((end ?? now) - (start ?? now))} ms</dd></dl><JsonView value={step.call.usage} /><h3>{tr.attempts}</h3><JsonView value={step.call.attempts} /></> },
        { label: tr.raw, content: <JsonView value={step.request.request} raw={step.request.body} /> },
      ];
    } else {
      const parent = turn.steps.find((item): item is AssistantStep => item.kind === "assistant" && item.step === step.parentStep);
      const definitions = parent?.tools;
      const schema = Array.isArray(definitions) ? definitions.find((value) => value && typeof value === "object" && "function" in value && value.function && typeof value.function === "object" && "name" in value.function && value.function.name === step.name) : undefined;
      tabs = [{ label: tr.asSent, content: step.message ? <JsonView value={step.message} /> : tr.unsent },
        { label: tr.arguments, content: <JsonView value={step.arguments} /> },
        { label: tr.mcp, content: <><p className="trajectory-notice">{tr.mcpNotice}</p>{step.mcpOutput === undefined ? tr.unavailable : <JsonView value={step.mcpOutput} />}</> },
        { label: tr.timing, content: <JsonView value={{ startedAt: step.startedAt === null ? null : new Date(step.startedAt).toISOString(), endedAt: step.endedAt === null ? null : new Date(step.endedAt).toISOString(), durationMs: step.startedAt === null ? null : (end ?? now) - step.startedAt, status: step.status }} /> },
        { label: tr.schema, content: schema === undefined ? tr.unavailable : <JsonView value={schema} /> }];
    }
  }
  const active = Math.min(tab, tabs.length - 1);
  return <aside className="trajectory-detail" aria-label={title}><header><strong>{title}</strong><button type="button" aria-label={tr.close} onClick={onClose}>×</button></header>
    <div role="tablist" aria-label={title}>{tabs.map((item, index) => <button type="button" role="tab" aria-selected={active === index} key={item.label} onClick={() => setTab(index)}>{item.label}</button>)}</div>
    <div role="tabpanel">{tabs[active]?.content}</div>
  </aside>;
}
