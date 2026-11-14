import type { UIMessage } from "ai";
import { z } from "zod";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronDown, ChevronRight, CheckCircle2, CircleAlert, CircleX, LoaderCircle, Square } from "lucide-react";
import { IssueMarkdown } from "../../issues/issue-markdown";
import type { AgentPageHost } from "./host";
import { useDebugMode } from "../../../shared/debug-mode";
import { Alert } from "../../../shared/ui/alert";
import { Button } from "../../../shared/ui/button";
import { Textarea } from "../../../shared/ui/textarea";
import { agentSessionIdSchema, isSystemReminder, messageReferences, messageSkills, messageSkillInvocation, sessionTitle, splitReferenceText } from "../agent.types";
import type { AgentMode, AgentSession } from "../agent.types";
import { AgentModelControls, AgentRepositorySelect, useAgentModel } from "./composer-settings";
import { useAgentClient } from "./client";
import { SkillDraftCard } from "../../skill-drafts/draft-card";
import { skillDraftResultId } from "./skill-draft-result";
import { SkillScopeBadge, SkillSource } from "./skill-source";
import { SkillMenu, useSkillMenu } from "./skill-menu";
import { AgentReferencePill } from "./references";
import { useAgentMessages } from "./messages";
import { pendingApprovals, resumableApprovalResponse } from "../approvals";
import { ApprovalCard } from "./approval-card";
import { HtmlViewDraftReview } from "../../html-views/drafts/draft-review";
import { HtmlViewStyleGallery } from "../../html-views/style-gallery";
import { htmlViewStylesResult } from "../../html-views/style-result";
import { replacedDraftIds } from "../replaced-drafts";
import { SessionModel, SessionPullRequest, SessionScope, SessionStatus, useAgentSessions } from "./sessions";
import type { StepPart, ToolPart } from "./summaries";
import { argumentSummary, cacheHitRate, durationLabel, messageBlocks, toolStatus, pullRequestUrl, resultSummary, summarize } from "./summaries";
import { renderCheckSchema } from "../../html-views/render-check";

type DraftFeedback = { readonly disabled: boolean; readonly send: (message: string) => void; readonly fill: (text: string) => void };

function SessionTabs({ session }: { readonly session: AgentSession }) {
  const [debug] = useDebugMode();
  const [tab, setTab] = useState("conversation");
  const activeTab = debug ? tab : "conversation";
  const [trajectoryModule, setTrajectoryModule] = useState<{ View: typeof import("./trajectory-view").TrajectoryView } | { error: unknown } | null>(null);
  useEffect(() => {
    if (!debug || trajectoryModule) return;
    let cancelled = false;
    void import("./trajectory-view").then(
      (module) => { if (!cancelled) setTrajectoryModule({ View: module.TrajectoryView }); },
      (error: unknown) => { if (!cancelled) setTrajectoryModule({ error }); },
    );
    return () => { cancelled = true; };
  }, [debug, trajectoryModule]);
  const TrajectoryView = trajectoryModule && "View" in trajectoryModule ? trajectoryModule.View : null;
  const viewport = useRef<Element | null>(null);
  const conversationScroll = useRef(0);
  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = activeTab === "conversation" ? conversationScroll.current : 0;
  }, [activeTab]);
  const m = useAgentMessages();
  if (activeTab === "trajectory" && trajectoryModule && "error" in trajectoryModule) throw trajectoryModule.error;
  return <>
    {debug ? <div className="flex gap-2 border-b border-border pb-2" role="tablist" aria-label={m.trajectory}>
      {[{ id: "conversation", label: m.conversation }, { id: "trajectory", label: m.trajectory }].map((item) =>
        <Button key={item.id} role="tab" aria-selected={tab === item.id} variant={tab === item.id ? "secondary" : "ghost"} onClick={(event) => {
          viewport.current = event.currentTarget.closest(".rd-viewport");
          if (activeTab === "conversation") conversationScroll.current = viewport.current?.scrollTop ?? 0;
          setTab(item.id);
        }}>{item.label}</Button>)}
    </div> : null}
    <SessionContent session={session} hidden={activeTab === "trajectory"} />
    {activeTab === "trajectory" ? TrajectoryView ? <TrajectoryView session={session} /> : <p role="status">{m.loading}</p> : null}
  </>;
}
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
      {session ? <SessionTabs key={session.id} session={session} /> : <p role="status">{sessions.isPending ? m.loading : m.missing}</p>}
    </div>
  </>, session ? sessionTitle(session) : m.agents, spaceId);
}
function SessionContent({ session, hidden }: { readonly session: AgentSession; readonly hidden: boolean }) {
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
  function fill(value: string) {
    const input = conversation.current?.querySelector<HTMLTextAreaElement>(".agent-followup textarea");
    if (hidden || pending || busyElsewhere || !input) return;
    setText(value);
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(value.length, value.length); });
  }
  useEffect(() => {
    const content = conversation.current;
    const viewport = content?.closest(".rd-viewport");
    if (!content || !viewport) return;
    let following = true;
    let lastScrollTop = viewport.scrollTop;
    const onScroll = () => {
      if (content.closest("[hidden]")) return;
      const top = viewport.scrollTop;
      const gap = viewport.scrollHeight - top - viewport.clientHeight;
      following = top < lastScrollTop ? gap < 1 : following || gap < 48;
      lastScrollTop = top;
    };
    const scrollToBottom = () => { if (following && !content.closest("[hidden]")) viewport.scrollTop = viewport.scrollHeight; };
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
  return <div className="agent-session-layout" hidden={hidden}>
    <div className="agent-conversation" ref={conversation}>
      <header className="agent-session-header"><h1>{sessionTitle(session)}</h1><SessionStatus session={session} /></header>
      <div className="agent-messages">{session.messages.map((message, index) => <article key={message.id} className={`agent-message agent-message-${message.role}`}>
        {message.role === "user" ? <UserMessage message={message} />
          : <AssistantMessage message={message} session={session} current={index === lastAssistant} latestStepsIndex={latestSteps?.messageIndex === index ? latestSteps.blockIndex : -1}
            feedback={{ disabled: hidden || pending || busyElsewhere || session.status === "running", send: (value) => void send(value), fill }} />}
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
  return <p>{prefix ? <span className="agent-skill-invocation"><code>{prefix}</code>{invocation && <SkillScopeBadge source={invocation.source} />}</span> : null}{splitReferenceText(text, messageReferences(message.metadata)).map((part, index) => typeof part === "string" ? part : <AgentReferencePill key={index} reference={part} linked />)}</p>;
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
  const sourceOrder = { repository: 0, user: 1, builtin: 2 };
  const skills = [...(catalog?.skills ?? [])].sort((a, b) => {
    if (used.has(a.name) || used.has(b.name)) return (used.get(a.name) ?? Infinity) - (used.get(b.name) ?? Infinity);
    return sourceOrder[a.source] - sourceOrder[b.source] || a.name.localeCompare(b.name);
  });
  const hidden = Math.max(0, skills.length - 3);
  return <>
    <h2>{m.skills}</h2>
    {catalog?.repository === "not-member" ? <p className="agent-note">{m.skillsNotMember}</p> : null}
    {!skills.length ? <p className="agent-note">{m.noSkills}</p> : <ul className="agent-skills">{skills.slice(0, expanded ? undefined : 3).map((skill) => <li key={skill.name} title={[skill.description, skill.path].filter(Boolean).join("\n")}>
      <span className="agent-skill-name">{skill.name}</span><SkillScopeBadge source={skill.source} />
      <SkillSource metadata={skill.metadata} />
      {used.has(skill.name) ? <span className="agent-skill-used">{m.skillUsed}</span> : null}
      <span className="agent-skill-description">{skill.description}</span>
    </li>)}</ul>}
    {hidden ? <button type="button" className="agent-skills-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? m.showFewerSkills : m.showMoreSkills(hidden)}</button> : null}
    {catalog?.diagnostics.length ? <section className="agent-skill-attention" aria-label={m.skillsAttention}>
      <h3><CircleAlert aria-hidden="true" />{m.skillsAttention}<span className="agent-skill-count">{catalog.diagnostics.length}</span></h3>
      <ul className="agent-skill-diagnostics">{catalog.diagnostics.map((diagnostic, index) => <li key={index}>
        <span className="agent-skill-problem">{m.skillProblems[diagnostic.problem]}</span><SkillScopeBadge source={diagnostic.source} />
        <code>{diagnostic.path}</code>{diagnostic.detail ? <span>{diagnostic.detail}</span> : null}
      </li>)}</ul>
    </section> : null}
  </>;
}
function AssistantMessage({ message, session, current, latestStepsIndex, feedback }: {
  readonly message: UIMessage; readonly session: AgentSession; readonly current: boolean; readonly latestStepsIndex: number; readonly feedback: DraftFeedback;
}) {
  const blocks = messageBlocks(message.parts);
  return blocks.map((block, index) => {
    const latest = index === latestStepsIndex;
    // Remount the previous latest group collapsed when a newer group appears.
    return block.kind === "text" ? <IssueMarkdown key={index} text={block.part.text} />
      : <AgentStepsGroup key={`${index}:${latest}`} parts={block.parts} session={session} current={current && index === blocks.length - 1} latest={latest} feedback={feedback} />;
  });
}
const RECENT_STEPS = 5;
export function AgentStepsGroup({ parts, session, current = false, latest = true, feedback }: {
  readonly parts: StepPart[]; readonly session: AgentSession; readonly current?: boolean; readonly latest?: boolean; readonly feedback?: DraftFeedback;
}) {
  const m = useAgentMessages();
  const replaced = useMemo(() => replacedDraftIds(session.messages), [session.messages]);
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
      {parts.slice(start).map((part, index) => <StepRow key={start + index} part={part} session={session} replaced={replaced} feedback={feedback} />)}
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
const checkedOutput = z.object({ structuredContent: z.object({ renderCheck: renderCheckSchema }) });
function StepRow({ part, session, replaced, feedback }: {
  readonly part: StepPart; readonly session: AgentSession; readonly replaced: ReadonlySet<string>; readonly feedback: DraftFeedback | undefined;
}) {
  const m = useAgentMessages();
  const [open, setOpen] = useState(false);
  const state = part.type === "reasoning" ? part.state === "streaming" ? session.status === "running" ? "running" : "incomplete" : "completed" : toolStatus(part, session.status);
  const running = state === "running";
  const Icon = state === "rejected" ? CircleX : state === "failed" || state === "incomplete" ? CircleAlert : state === "completed" ? CheckCircle2 : LoaderCircle;
  const status = state === "rejected" ? m.toolRejected : state === "approval" ? m.waitingApproval : state === "failed" ? m.toolFailed : state === "completed" ? m.toolDone : m[session.status];
  const timing = part.type !== "reasoning" ? session.toolTimings[part.toolCallId] : undefined;
  const parsedDraft = part.type !== "reasoning" && part.state === "output-available" &&
    ["html_view_create", "html_view_replace"].includes(toolName(part)) ? pageDraftOutput.safeParse(part.output) : null;
  const skillDraftId = part.type !== "reasoning" && part.state === "output-available" ? skillDraftResultId(toolName(part), part.output) : null;
  const draftId = parsedDraft?.success && !parsedDraft.data.isError ? parsedDraft.data.structuredContent.draft.id : null;
  const styles = part.type !== "reasoning" && part.state === "output-available" ? htmlViewStylesResult(toolName(part), part.output) : null;
  return <div className="agent-step" data-status={state}>
    <button type="button" className="agent-step-row" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Icon className={running ? "agent-step-icon animate-spin" : "agent-step-icon"} role="img" aria-label={status} />
      <span className={part.type === "reasoning" ? "agent-step-label" : "agent-step-name"}>{part.type === "reasoning" ? running ? m.thinkingStep : m.thought : toolName(part)}</span>
      <span className="agent-step-preview">{part.type === "reasoning" ? part.text.trimStart().split(/\r?\n/, 1)[0] : argumentSummary(part.input)}</span>
      {state === "approval" || state === "rejected" ? <span>{status}</span> : null}
      {part.type !== "reasoning" ? <span className="agent-step-duration">{timing ? durationLabel(timing.startedAt, timing.endedAt ?? (running ? new Date().toISOString() : null)) : "—"}</span> : null}
    </button>
    {skillDraftId && <SkillDraftCard draftId={skillDraftId} />}
    {styles && <HtmlViewStyleGallery catalog={styles} onFill={feedback?.fill} disabled={feedback?.disabled ?? true} />}
    {draftId && <HtmlViewDraftReview key={draftId} draftId={draftId} presentation="card" replaced={replaced.has(draftId)}
      onRequestChanges={feedback?.send} requestChangesDisabled={feedback?.disabled ?? session.status === "running"} />}
    {open ? <div className="agent-step-body">{part.type === "reasoning" ? <IssueMarkdown text={part.text} /> : <ToolBody part={part} state={state} status={status} />}</div> : null}
  </div>;
}
function ToolBody({ part, state, status }: { readonly part: ToolPart; readonly state: ReturnType<typeof toolStatus>; readonly status: string }) {
  const m = useAgentMessages();
  const output = "output" in part ? part.output : undefined;
  const url = pullRequestUrl(output, window.location.origin);
  const error = "errorText" in part ? part.errorText : undefined;
  const completed = state === "completed" || state === "failed";
  const checked = checkedOutput.safeParse(output);
  return <dl><dt>{m.arguments}</dt><dd>{summarize(part.input)}</dd>
    <dt>{m.result}</dt><dd>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{resultSummary(output, status, part.input)}</a> : error ? resultSummary(error, status) : completed ? resultSummary(output, status, part.input) : state === "running" ? m.pending : status}</dd>
    {checked.success && <><dt>{m.renderCheck}</dt><dd><pre>{JSON.stringify(checked.data.structuredContent.renderCheck, null, 2)}</pre></dd></>}
  </dl>;
}
