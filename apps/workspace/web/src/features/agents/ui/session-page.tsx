import type { UIMessage } from "ai";
import { useEffect, useState } from "react";
import { ArrowUp, ChevronDown, ChevronRight, CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { IssueMarkdown } from "../../issues/issue-markdown";
import type { AgentPageHost } from "./host";
import { Alert } from "../../../shared/ui/alert";
import { Button } from "../../../shared/ui/button";
import { Textarea } from "../../../shared/ui/textarea";
import { agentSessionIdSchema, isSystemReminder, messageReferences, sessionTitle, splitReferenceText } from "../agent.types";
import type { AgentMode, AgentSession } from "../agent.types";
import { AgentModelControls, AgentRepositorySelect, useAgentModel } from "./composer-settings";
import { useAgentClient } from "./client";
import { AgentReferencePill } from "./references";
import { useAgentMessages } from "./messages";
import { SessionModel, SessionPullRequest, SessionScope, SessionStatus, useAgentSessions } from "./sessions";
import type { StepPart, ToolPart } from "./summaries";
import { argumentSummary, cacheHitRate, durationLabel, messageBlocks, toolStatus, pullRequestUrl, resultSummary, summarize } from "./summaries";

export function AgentSessionPage({ sessionId, renderPage }: AgentPageHost & { readonly sessionId: string }) {
  const m = useAgentMessages();
  const client = useAgentClient();
  const sessions = useAgentSessions();
  const [runtimeError, setRuntimeError] = useState("");
  const session = sessions.data?.find((item) => item.id === sessionId);
  useEffect(() => { void client.prewarm().catch((cause: unknown) => setRuntimeError(String(cause))); }, [client]);
  const spaceId = session?.scope.kind === "repository" ? session.scope.spaceId : undefined;
  return renderPage(<>
    <div className="agent-page">
      {runtimeError ? <Alert variant="destructive">{runtimeError}</Alert> : null}
      {sessions.error ? <Alert variant="destructive">{sessions.error.message}</Alert> : null}
      {session ? <SessionContent key={session.id} session={session} /> : <p role="status">{sessions.isPending ? m.loading : m.missing}</p>}
    </div>
  </>, session ? sessionTitle(session) : m.agents, spaceId);
}
function SessionContent({ session }: { readonly session: AgentSession }) {
  const m = useAgentMessages();
  const client = useAgentClient();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<AgentMode>(session.mode);
  const sessionRepository = session.scope.kind === "repository" ? session.scope.spaceId : "";
  const [repository, setRepository] = useState(sessionRepository);
  const model = useAgentModel(session.model);
  const { selected, thinking } = model;
  useEffect(() => { setMode(session.mode); }, [session.mode]);
  useEffect(() => { setRepository(sessionRepository); }, [sessionRepository]);
  const [error, setError] = useState("");
  const [busyElsewhere, setBusyElsewhere] = useState(false);
  const [pending, setPending] = useState(false);
  async function send(value: string) {
    if (!value.trim() || pending) return;
    if (!selected && session.status !== "running") { model.setSettings(true); return; }
    setPending(true); setError("");
    try {
      await (await client.runner()).send(agentSessionIdSchema.parse(session.id), value.trim(), session.status === "running" || !selected ? session : {
        mode, scope: repository ? { kind: "repository", spaceId: repository,
          baseWorktreeId: session.scope.kind === "repository" && session.scope.spaceId === repository ? session.scope.baseWorktreeId : null } : { kind: "global" },
        model: { providerId: selected.provider.id, modelId: selected.modelId, thinking: selected.provider.kind === "deepseek" ? thinking : null },
      });
      setText("");
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "AGENT_BUSY") setBusyElsewhere(true);
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setPending(false); }
  }
  useEffect(() => {
    let cancelled = false;
    void client.runner().then((runner) => { if (!cancelled) setBusyElsewhere(session.status === "running" && !runner.isRunningHere(session.id)); })
      .catch((cause: unknown) => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [client, session.id, session.status]);
  const lastAssistant = session.messages.map((message) => message.role).lastIndexOf("assistant");
  return <div className="agent-session-layout">
    <div className="agent-conversation">
      <header className="agent-session-header"><h1>{sessionTitle(session)}</h1><SessionStatus status={session.status} /></header>
      <div className="agent-messages">{session.messages.map((message, index) => <article key={message.id} className={`agent-message agent-message-${message.role}`}>
        {message.role === "user" ? <p>{splitReferenceText(message.parts.filter((part) => !isSystemReminder(part)).filter((part) => part.type === "text").map((part) => part.text).join("\n"), messageReferences(message.metadata)).map((part, index) => typeof part === "string" ? part : <AgentReferencePill key={index} reference={part} linked />)}</p>
          : <AssistantMessage message={message} session={session} current={index === lastAssistant} />}
      </article>)}</div>
      {session.error ? <Alert variant="destructive">{session.error}</Alert> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {busyElsewhere ? <Alert>{m.busy}</Alert> : <form className="agent-followup" onSubmit={(event) => { event.preventDefault(); void send(text); }}>
        <AgentRepositorySelect repository={repository} setRepository={setRepository} disabled={pending || session.status === "running"} />
        <div className="agent-composer-box">
          <Textarea aria-label={m.followup} placeholder={m.followup} value={text} disabled={pending} rows={3} onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (!event.nativeEvent.isComposing && (event.shiftKey || event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void send(text); } }} />
          <div className="agent-composer-controls">
            <AgentModelControls mode={mode} setMode={setMode} model={model} disabled={pending || session.status === "running"} />
            {session.status === "running" ? <Button variant="secondary" onClick={() => {
              setPending(true);
              void client.runner().then((runner) => runner.stop(session.id)).catch((cause: unknown) => setError(String(cause))).finally(() => setPending(false));
            }} disabled={pending}>{m.stop}</Button> : ["interrupted", "stopped", "failed"].includes(session.status) ? <Button variant="secondary" disabled={pending} onClick={() => void send(m.continue)}>{m.continue}</Button> : null}
            <Button className="agent-send" type="submit" aria-label={m.send} aria-keyshortcuts="Shift+Enter" disabled={pending || !text.trim()}><ArrowUp aria-hidden="true" /><span>{m.send}</span><kbd aria-hidden="true">⇧↵</kbd></Button>
          </div>
        </div>
        <p className="agent-note">{mode === "ask" ? m.askHint : m.autoHint}</p>
      </form>}
    </div>
    <aside className="agent-session-rail"><h2>{m.sessions}</h2><dl>
      <dt>{m.scope}</dt><dd><SessionScope session={session} /></dd>
      <dt>{m.mode}</dt><dd>{m[session.mode]}</dd><dt>{m.model}</dt><dd><SessionModel model={session.model} /></dd>
      <dt>{m.cacheHitRate}</dt><dd>{m.cacheOverall} {cacheHitRate(session.cacheUsage)} · {m.cacheLastStep} {cacheHitRate(session.cacheUsage.lastStep)}</dd>
    </dl><h2>{m.prs}</h2>{session.worktreeIds.map((id) => <SessionPullRequest key={id} id={id} />)}<p className="agent-note">{m.local}</p></aside>
  </div>;
}
function AssistantMessage({ message, session, current }: { readonly message: UIMessage; readonly session: AgentSession; readonly current: boolean }) {
  const blocks = messageBlocks(message.parts);
  return blocks.map((block, index) => block.kind === "text" ? <IssueMarkdown key={index} text={block.part.text} />
    : <AgentStepsGroup key={index} parts={block.parts} session={session} current={current && index === blocks.length - 1} />);
}
const RECENT_STEPS = 5;
export function AgentStepsGroup({ parts, session, current = false }: { readonly parts: StepPart[]; readonly session: AgentSession; readonly current?: boolean }) {
  const m = useAgentMessages();
  const [view, setView] = useState<"collapsed" | "recent" | "all">("recent");
  const last = parts.at(-1);
  const working = current && session.status === "running";
  const thoughts = parts.filter((part) => part.type === "reasoning").length;
  const failures = parts.filter((part) => part.type !== "reasoning" && toolStatus(part, session.status) === "failed").length;
  const HeadIcon = working ? LoaderCircle : view === "collapsed" ? ChevronRight : ChevronDown;
  const start = view === "recent" ? Math.max(0, parts.length - RECENT_STEPS) : 0;
  return <div className="agent-steps">
    <button type="button" className="agent-steps-head" aria-expanded={view !== "collapsed"} onClick={() => setView(view === "collapsed" ? "recent" : "collapsed")}>
      <HeadIcon aria-hidden="true" className={working ? "agent-step-icon animate-spin" : "agent-step-icon"} />
      <strong>{working ? m.working : m.worked}</strong>
      <span className="agent-step-preview">{working && last ? last.type === "reasoning" ? m.thinkingStep : `${toolName(last)} ${argumentSummary(last.input)}` : m.stepCounts(thoughts, parts.length - thoughts)}</span>
      {!working && failures > 0 ? <span className="agent-steps-failed">{m.failedSteps(failures)}</span> : null}
    </button>
    {view !== "collapsed" ? <div className="agent-steps-list">
      {parts.length > RECENT_STEPS ? <button type="button" className="agent-steps-window" onClick={() => setView(view === "all" ? "recent" : "all")}>{view === "all" ? m.showLatestSteps(RECENT_STEPS) : m.showEarlierSteps(parts.length - RECENT_STEPS)}</button> : null}
      {parts.slice(start).map((part, index) => <StepRow key={start + index} part={part} session={session} />)}
    </div> : null}
  </div>;
}
function toolName(part: ToolPart) {
  return part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
}
function StepRow({ part, session }: { readonly part: StepPart; readonly session: AgentSession }) {
  const m = useAgentMessages();
  const [open, setOpen] = useState(false);
  const state = part.type === "reasoning" ? part.state === "streaming" ? session.status === "running" ? "running" : "incomplete" : "completed" : toolStatus(part, session.status);
  const running = state === "running";
  const Icon = state === "failed" || state === "incomplete" ? CircleAlert : state === "completed" ? CheckCircle2 : LoaderCircle;
  const status = state === "failed" ? m.toolFailed : state === "completed" ? m.toolDone : m[session.status];
  const timing = part.type !== "reasoning" ? session.toolTimings[part.toolCallId] : undefined;
  return <div className="agent-step" data-status={state}>
    <button type="button" className="agent-step-row" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Icon className={running ? "agent-step-icon animate-spin" : "agent-step-icon"} role="img" aria-label={status} />
      <span className={part.type === "reasoning" ? "agent-step-label" : "agent-step-name"}>{part.type === "reasoning" ? running ? m.thinkingStep : m.thought : toolName(part)}</span>
      <span className="agent-step-preview">{part.type === "reasoning" ? part.text.trimStart().split(/\r?\n/, 1)[0] : argumentSummary(part.input)}</span>
      {part.type !== "reasoning" ? <span className="agent-step-duration">{timing ? durationLabel(timing.startedAt, timing.endedAt ?? (running ? new Date().toISOString() : null)) : "—"}</span> : null}
    </button>
    {open ? <div className="agent-step-body">{part.type === "reasoning" ? <IssueMarkdown text={part.text} /> : <ToolBody part={part} state={state} status={status} />}</div> : null}
  </div>;
}
function ToolBody({ part, state, status }: { readonly part: ToolPart; readonly state: ReturnType<typeof toolStatus>; readonly status: string }) {
  const m = useAgentMessages();
  const output = "output" in part ? part.output : undefined;
  const url = pullRequestUrl(output, window.location.origin);
  const error = "errorText" in part ? part.errorText : undefined;
  const completed = state === "completed" || state === "failed";
  return <dl><dt>{m.arguments}</dt><dd>{summarize(part.input)}</dd>
    <dt>{m.result}</dt><dd>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{resultSummary(output, status, part.input)}</a> : error ? resultSummary(error, status) : completed ? resultSummary(output, status, part.input) : state === "running" ? m.pending : status}</dd></dl>;
}
