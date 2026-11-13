import type { UIMessage } from "ai";
import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, ChevronRight, CheckCircle2, CircleAlert, CircleX, LoaderCircle, Square } from "lucide-react";
import { IssueMarkdown } from "../../issues/issue-markdown";
import type { AgentPageHost } from "./host";
import { Alert } from "../../../shared/ui/alert";
import { Button } from "../../../shared/ui/button";
import { Textarea } from "../../../shared/ui/textarea";
import { agentSessionIdSchema, isSystemReminder, messageReferences, messageSkills, messageSkillInvocation, sessionTitle, splitReferenceText } from "../agent.types";
import type { AgentMode, AgentSession } from "../agent.types";
import { AgentModelControls, AgentRepositorySelect, useAgentModel } from "./composer-settings";
import { useAgentClient } from "./client";
import { SkillMenu, useSkillMenu } from "./skill-menu";
import { AgentReferencePill } from "./references";
import { useAgentMessages } from "./messages";
import { pendingApprovals, resumableApprovalResponse } from "../approvals";
import { ApprovalCard } from "./approval-card";
import { HtmlViewDraftReview } from "../../html-views/drafts/draft-review";
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
  const skillMenu = useSkillMenu(text, repository ? { kind: "repository", spaceId: repository, baseWorktreeId: null } : { kind: "global" }, pending || session.status === "running", setText);
  const action = session.status === "running" && !text.trim() ? "stop" : "send";
  const conversation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const content = conversation.current;
    const viewport = content?.closest(".rd-viewport");
    if (!content || !viewport) return;
    let following = true;
    let lastScrollTop = viewport.scrollTop;
    const onScroll = () => {
      const top = viewport.scrollTop;
      const gap = viewport.scrollHeight - top - viewport.clientHeight;
      following = top < lastScrollTop ? gap < 1 : following || gap < 48;
      lastScrollTop = top;
    };
    const scrollToBottom = () => { if (following) viewport.scrollTop = viewport.scrollHeight; };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(scrollToBottom);
    observer.observe(content);
    scrollToBottom();
    return () => { observer.disconnect(); viewport.removeEventListener("scroll", onScroll); };
  }, []);
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
  async function decide(approvalId: string, approved: boolean) {
    setPending(true); setError("");
    try { await (await client.runner()).decide(session.id, approvalId, approved); }
    catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "AGENT_BUSY") setBusyElsewhere(true);
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setPending(false); }
  }
  const approvals = pendingApprovals(session);
  const resumableApproval = resumableApprovalResponse(session.messages);
  const lastAssistant = session.messages.map((message) => message.role).lastIndexOf("assistant");
  const latestSteps = session.messages.reduce<{ messageIndex: number; blockIndex: number } | null>((latest, message, messageIndex) => {
    if (message.role === "user") return latest;
    const blockIndex = messageBlocks(message.parts).map((block) => block.kind).lastIndexOf("steps");
    return blockIndex < 0 ? latest : { messageIndex, blockIndex };
  }, null);
  return <div className="agent-session-layout">
    <div className="agent-conversation" ref={conversation}>
      <header className="agent-session-header"><h1>{sessionTitle(session)}</h1><SessionStatus session={session} /></header>
      <div className="agent-messages">{session.messages.map((message, index) => <article key={message.id} className={`agent-message agent-message-${message.role}`}>
        {message.role === "user" ? <UserMessage message={message} />
          : <AssistantMessage message={message} session={session} current={index === lastAssistant} latestStepsIndex={latestSteps?.messageIndex === index ? latestSteps.blockIndex : -1} />}
      </article>)}</div>
      <div className="agent-session-dock">
        {session.error ? <Alert variant="destructive">{session.error}</Alert> : null}
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <div className="agent-approvals">{approvals.map((approval) => <ApprovalCard key={approval.approvalId} approval={approval}
          disabled={pending || busyElsewhere} onDecide={(approved) => void decide(approval.approvalId, approved)} />)}</div>
        {busyElsewhere ? <Alert>{m.busy}</Alert> : <form className="agent-followup" onSubmit={(event) => { event.preventDefault(); void send(text); }}>
          <div className="agent-composer-box">
            <SkillMenu menu={skillMenu} />
            <Textarea {...skillMenu.inputProps} aria-label={m.followup} placeholder={m.followup} value={text} disabled={pending} rows={2} onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || skillMenu.onKeyDown(event.nativeEvent)) return;
                if (event.ctrlKey && event.key.toLowerCase() === "j") {
                  event.preventDefault();
                  const input = event.currentTarget;
                  input.setRangeText("\n", input.selectionStart, input.selectionEnd, "end");
                  setText(input.value);
                } else if (event.key === "Enter" && (!event.shiftKey || event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(text); }
              }} />
            <div className="agent-composer-controls">
              <AgentModelControls mode={mode} setMode={setMode} model={model} disabled={pending || session.status === "running"}>
                <AgentRepositorySelect repository={repository} setRepository={setRepository} disabled={pending || session.status === "running"} />
              </AgentModelControls>
              {["interrupted", "stopped", "failed"].includes(session.status) ? <Button variant="secondary" disabled={pending} onClick={() => resumableApproval ? void decide(resumableApproval.id, resumableApproval.approved) : void send(m.continue)}>{m.continue}</Button> : null}
              <Button className="agent-send" type={action === "stop" ? "button" : "submit"} aria-label={m[action]} aria-keyshortcuts={action === "send" ? "Enter" : undefined}
                disabled={pending || (action === "send" && !text.trim())} onClick={action === "stop" ? () => {
                  setPending(true);
                  void client.runner().then((runner) => runner.stop(session.id)).catch((cause: unknown) => setError(String(cause))).finally(() => setPending(false));
                } : undefined}>
                {action === "stop" ? <Square aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}<span>{m[action]}</span>{action === "send" ? <kbd aria-hidden="true">↵</kbd> : null}
              </Button>
            </div>
          </div>
        </form>}
      </div>
    </div>
    <aside className="agent-session-rail"><h2>{m.sessions}</h2><dl>
      <dt>{m.scope}</dt><dd><SessionScope session={session} /></dd>
      <dt>{m.mode}</dt><dd>{m[session.mode]}</dd><dt>{m.model}</dt><dd><SessionModel model={session.model} /></dd>
      <dt>{m.cacheHitRate}</dt><dd>{m.cacheOverall} {cacheHitRate(session.cacheUsage)} · {m.cacheLastStep} {cacheHitRate(session.cacheUsage.lastStep)}</dd>
    </dl><SessionSkills session={session} /><h2>{m.prs}</h2>{session.worktreeIds.map((id) => <SessionPullRequest key={id} id={id} />)}<p className="agent-note">{m.local}</p></aside>
  </div>;
}
function UserMessage({ message }: { readonly message: UIMessage }) {
  let text = message.parts.filter((part) => !isSystemReminder(part)).filter((part) => part.type === "text").map((part) => part.text).join("\n");
  const invocation = messageSkillInvocation(message.metadata);
  const prefix = invocation && text.startsWith(`/${invocation.name}`) ? `/${invocation.name}` : null;
  if (prefix) text = text.slice(prefix.length);
  return <p>{prefix ? <span className="agent-reference agent-skill-invocation">{prefix}</span> : null}{splitReferenceText(text, messageReferences(message.metadata)).map((part, index) => typeof part === "string" ? part : <AgentReferencePill key={index} reference={part} linked />)}</p>;
}
const skillReadInput = z.object({ name: z.string() });
const skillReadOutput = z.object({ isError: z.boolean().optional() });
function SessionSkills({ session }: { readonly session: AgentSession }) {
  const m = useAgentMessages();
  const [expanded, setExpanded] = useState(false);
  const catalog = session.messages.filter((message) => message.role === "user").map((message) => messageSkills(message.metadata))
    .reverse().find((value) => value !== null);
  const used = new Map<string, number>();
  for (const message of session.messages) {
    const invocation = message.role === "user" ? messageSkillInvocation(message.metadata) : null;
    if (invocation && !used.has(invocation.name)) used.set(invocation.name, used.size);
    for (const part of message.parts) {
      if (part.type !== "dynamic-tool" || part.toolName !== "skills_read" || part.state !== "output-available") continue;
      const input = skillReadInput.safeParse(part.input);
      const output = skillReadOutput.safeParse(part.output);
      if (input.success && output.success && !output.data.isError && !used.has(input.data.name)) used.set(input.data.name, used.size);
    }
  }
  const skills = [...(catalog?.skills ?? [])].sort((a, b) => {
    if (used.has(a.name) || used.has(b.name)) return (used.get(a.name) ?? Infinity) - (used.get(b.name) ?? Infinity);
    return (a.source === b.source ? 0 : a.source === "repository" ? -1 : 1) || a.name.localeCompare(b.name);
  });
  const hidden = Math.max(0, skills.length - 3);
  return <>
    <h2>{m.skills}</h2>
    {catalog?.repository === "not-member" ? <p className="agent-note">{m.skillsNotMember}</p> : null}
    {!skills.length ? <p className="agent-note">{m.noSkills}</p> : <ul className="agent-skills">{skills.slice(0, expanded ? undefined : 3).map((skill) => <li key={skill.name} title={[skill.description, skill.path].filter(Boolean).join("\n")}>
      <span className="agent-skill-name">{skill.name}</span><span className="agent-skill-source">{skill.source === "repository" ? m.repository : m.personalSkill}</span>
      {used.has(skill.name) ? <span className="agent-skill-used">{m.skillUsed}</span> : null}
    </li>)}</ul>}
    {hidden || catalog?.diagnostics.length ? <button type="button" className="agent-steps-window" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? hidden ? m.showFewerSkills : m.hideSkillDiagnostics : hidden ? m.showMoreSkills(hidden) : m.showSkillDiagnostics}
    </button> : null}
    {expanded && catalog?.diagnostics.length ? <ul className="agent-skill-diagnostics">{catalog.diagnostics.map((diagnostic, index) => <li key={index}>
      {diagnostic.source === "repository" ? m.repository : m.personalSkill} · {m.skillProblems[diagnostic.problem]} · {diagnostic.path}{diagnostic.detail ? ` · ${diagnostic.detail}` : ""}
    </li>)}</ul> : null}
  </>;
}
function AssistantMessage({ message, session, current, latestStepsIndex }: { readonly message: UIMessage; readonly session: AgentSession; readonly current: boolean; readonly latestStepsIndex: number }) {
  const blocks = messageBlocks(message.parts);
  return blocks.map((block, index) => {
    const latest = index === latestStepsIndex;
    // Remount the previous latest group collapsed when a newer group appears.
    return block.kind === "text" ? <IssueMarkdown key={index} text={block.part.text} />
      : <AgentStepsGroup key={`${index}:${latest}`} parts={block.parts} session={session} current={current && index === blocks.length - 1} latest={latest} />;
  });
}
const RECENT_STEPS = 5;
export function AgentStepsGroup({ parts, session, current = false, latest = true }: { readonly parts: StepPart[]; readonly session: AgentSession; readonly current?: boolean; readonly latest?: boolean }) {
  const m = useAgentMessages();
  const [view, setView] = useState<"collapsed" | "recent" | "all">(latest ? "recent" : "collapsed");
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
const pageDraftOutput = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.object({ draft: z.object({ id: z.string().min(1) }) }),
});
function StepRow({ part, session }: { readonly part: StepPart; readonly session: AgentSession }) {
  const m = useAgentMessages();
  const [open, setOpen] = useState(false);
  const state = part.type === "reasoning" ? part.state === "streaming" ? session.status === "running" ? "running" : "incomplete" : "completed" : toolStatus(part, session.status);
  const running = state === "running";
  const Icon = state === "rejected" ? CircleX : state === "failed" || state === "incomplete" ? CircleAlert : state === "completed" ? CheckCircle2 : LoaderCircle;
  const status = state === "rejected" ? m.toolRejected : state === "approval" ? m.waitingApproval : state === "failed" ? m.toolFailed : state === "completed" ? m.toolDone : m[session.status];
  const timing = part.type !== "reasoning" ? session.toolTimings[part.toolCallId] : undefined;
  const parsedDraft = part.type !== "reasoning" && part.state === "output-available" &&
    ["html_view_create", "html_view_replace"].includes(toolName(part)) ? pageDraftOutput.safeParse(part.output) : null;
  const draftId = parsedDraft?.success && !parsedDraft.data.isError ? parsedDraft.data.structuredContent.draft.id : null;
  return <div className="agent-step" data-status={state}>
    <button type="button" className="agent-step-row" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Icon className={running ? "agent-step-icon animate-spin" : "agent-step-icon"} role="img" aria-label={status} />
      <span className={part.type === "reasoning" ? "agent-step-label" : "agent-step-name"}>{part.type === "reasoning" ? running ? m.thinkingStep : m.thought : toolName(part)}</span>
      <span className="agent-step-preview">{part.type === "reasoning" ? part.text.trimStart().split(/\r?\n/, 1)[0] : argumentSummary(part.input)}</span>
      {state === "approval" || state === "rejected" ? <span>{status}</span> : null}
      {part.type !== "reasoning" ? <span className="agent-step-duration">{timing ? durationLabel(timing.startedAt, timing.endedAt ?? (running ? new Date().toISOString() : null)) : "—"}</span> : null}
    </button>
    {draftId && <HtmlViewDraftReview key={draftId} draftId={draftId} presentation="card" />}
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
