import type { UIMessage } from "ai";
import { useEffect, useState } from "react";
import { ArrowUp, CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { IssueMarkdown } from "../../issues/issue-markdown";
import type { AgentPageHost } from "./host";
import { Alert } from "../../../shared/ui/alert";
import { Button } from "../../../shared/ui/button";
import { Textarea } from "../../../shared/ui/textarea";
import { agentSessionIdSchema, isSystemReminder, sessionTitle } from "../agent.types";
import type { AgentMode, AgentSession } from "../agent.types";
import { AgentModelControls, AgentRepositorySelect, useAgentModel } from "./composer-settings";
import { useAgentClient } from "./client";
import { useAgentMessages } from "./messages";
import { SessionModel, SessionPullRequest, SessionScope, SessionStatus, useAgentSessions } from "./sessions";
import { argumentSummary, cacheHitRate, durationLabel, pullRequestUrl, resultSummary, summarize } from "./summaries";

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
  return <div className="agent-session-layout">
    <div className="agent-conversation">
      <header className="agent-session-header"><h1>{sessionTitle(session)}</h1><SessionStatus status={session.status} /></header>
      <div className="agent-messages">{session.messages.map((message) => <article key={message.id} className={`agent-message agent-message-${message.role}`}>
        {message.role === "user" ? <p>{message.parts.filter((part) => !isSystemReminder(part)).filter((part) => part.type === "text").map((part) => part.text).join("\n")}</p>
          : message.parts.map((part, index) => <MessagePart key={index} part={part} session={session} />)}
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
function MessagePart({ part, session }: { readonly part: UIMessage["parts"][number]; readonly session: AgentSession }) {
  const m = useAgentMessages();
  if (part.type === "text") return <IssueMarkdown text={part.text} />;
  if (part.type === "reasoning") return <details className="agent-reasoning"><summary>{m.reasoning}</summary><IssueMarkdown text={part.text} /></details>;
  if (!("toolCallId" in part)) return null;
  const name = part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
  const timing = session.toolTimings[part.toolCallId];
  const output = "output" in part ? part.output : undefined;
  const url = pullRequestUrl(output, window.location.origin);
  const error = "errorText" in part ? part.errorText : undefined;
  const input = "input" in part ? part.input : undefined;
  const failed = part.state === "output-error" || part.state === "output-denied" || Boolean(output && typeof output === "object" && "isError" in output && output.isError);
  const completed = part.state === "output-available" || failed;
  const running = !completed && session.status === "running";
  const Icon = failed || !completed && !running ? CircleAlert : completed ? CheckCircle2 : LoaderCircle;
  const status = failed ? m.toolFailed : completed ? m.toolDone : m[session.status];
  return <details className="agent-tool" data-failed={failed || undefined}>
    <summary>
      <span className="agent-tool-name">{name}</span>
      <span className="agent-tool-arguments">{argumentSummary(input)}</span>
      <Icon className={running ? "agent-tool-status animate-spin" : "agent-tool-status"} role="img" aria-label={status} />
      <span className="agent-tool-duration">{timing ? durationLabel(timing.startedAt, timing.endedAt ?? (running ? new Date().toISOString() : null)) : "—"}</span>
    </summary>
    <dl><dt>{m.arguments}</dt><dd>{summarize(input)}</dd>
      <dt>{m.result}</dt><dd>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{resultSummary(output, status, input)}</a> : error ? resultSummary(error, status) : completed ? resultSummary(output, status, input) : running ? m.pending : status}</dd></dl>
  </details>;
}
