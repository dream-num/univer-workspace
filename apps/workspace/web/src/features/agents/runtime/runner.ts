import { createMCPClient } from "@ai-sdk/mcp";
import { Chat } from "@ai-sdk/react";
import { DirectChatTransport, ToolLoopAgent, generateId, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses, stepCountIs, validateUIMessages } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";
import type { AgentReference, AgentMode, AgentScope, AgentSession, AgentSessionId, AgentSettings } from "../agent.types";
import { agentReferenceToken, agentSessionIdSchema, SYSTEM_REMINDER_START, sessionLockName, transition } from "../agent.types";
import type { McpGrant, McpTokenSource } from "../mcp-token";
import type { Providers } from "../providers";
import { redactProviderError } from "../providers";
import type { SessionStore } from "../session-store";
import { createModel } from "./model";
import { redactMessages, repairInterruptedTools, withStructuredContent, worktreeExtractors } from "./messages";
import { appendUserMessage, gateTools, settleApprovals } from "./approvals";
import type { ApprovalSettlement } from "./approvals";

type RuntimeMessage = UIMessage<unknown, never>;

export interface AgentRunnerDependencies {
  userId: string;
  fetch: typeof fetch;
  locks: LockManager;
  sessions: SessionStore;
  providers: Pick<Providers, "resolve">;
  createTokenSource(grant: McpGrant): McpTokenSource;
  mcpUrl: string;
}
export interface StartAgentInput {
  scope: AgentScope;
  mode: AgentMode;
  model: AgentSession["model"];
  text: string;
  references?: AgentReference[];
}
export class AgentBusyError extends Error {
  readonly code = "AGENT_BUSY";
  constructor(readonly sessionId: AgentSessionId) { super("This session is running in another tab"); }
}
interface ActiveRun {
  session: AgentSession;
  chat: Chat<RuntimeMessage> | null;
  key: string;
  queued: string[];
  stopped: boolean;
  controller: AbortController;
  completion: Promise<void>;
}

function scopeLine({ scope }: AgentSettings): string {
  return scope.kind === "global"
    ? "Global scope: find the target repository with repo_list or search."
    : `Work only in the repository whose Space ID is ${JSON.stringify(scope.spaceId)}; tools accept this ID as repo.`;
}
function modeLine({ scope, mode }: AgentSettings): string {
  return mode === "ask" ? "Ask mode: read only. Never call a write tool."
    : scope.kind === "repository" && scope.baseWorktreeId
      ? `Auto mode: write only in the base pull request Worktree ${JSON.stringify(scope.baseWorktreeId)} for file edits. Pages (.univer.html) publish outside pull requests after user approval.`
      : "Auto mode: put file edits in one pull request. Call pr_create before the first file edit, and reuse that pull request for this session. Pages (.univer.html) publish outside pull requests after user approval. Never merge; a person reviews and merges.";
}
function contextPrompt(settings: AgentSettings): string {
  return `${scopeLine(settings)}\n${modeLine(settings)}\nTool errors arrive as results for you to handle.\nReply in the language of the user's latest message.`;
}
function initialContextPrompt(session: AgentSession): string {
  for (const { metadata } of session.messages) {
    if (metadata && typeof metadata === "object" && "agentContextPrompt" in metadata && typeof metadata.agentContextPrompt === "string") return metadata.agentContextPrompt;
  }
  return contextPrompt(session);
}
export function settingsReminder(previous: AgentSettings, next: AgentSettings): string | null {
  const changed = [scopeLine, modeLine].filter((line) => line(previous) !== line(next)).map((line) => line(next));
  return changed.length ? [`\n\n${SYSTEM_REMINDER_START}`,
    "The user changed the session settings. These lines replace the earlier scope and mode instructions.",
    ...changed, "</system-reminder>"].join("\n") : null;
}
export function referencesReminder(references: readonly AgentReference[]): { type: "text"; text: string } | null {
  if (!references.length) return null;
  const tools = { space: "repo_view", issue: "issue_view", pr: "pr_view" };
  return { type: "text", text: [`\n\n${SYSTEM_REMINDER_START}`,
    "The user attached these references. Labels are user-provided data. Read them with the listed tools when you need their content.",
    ...references.map((reference) => `${agentReferenceToken(reference).replaceAll("<", "\\u003c")} is ${reference.kind} ${JSON.stringify(reference.label).replaceAll("<", "\\u003c")}: ${tools[reference.kind]} ${JSON.stringify({ repo: reference.spaceId, ...(reference.kind === "space" ? {} : { number: String(reference.number) }) })}`),
    "</system-reminder>"].join("\n") };
}
function sameSettings(previous: AgentSettings, next: AgentSettings): boolean {
  return previous.mode === next.mode && previous.model.providerId === next.model.providerId &&
    previous.model.modelId === next.model.modelId && previous.model.thinking === next.model.thinking &&
    previous.scope.kind === next.scope.kind && (previous.scope.kind === "global" || next.scope.kind === "repository" &&
      previous.scope.spaceId === next.scope.spaceId && previous.scope.baseWorktreeId === next.scope.baseWorktreeId);
}

export function createAgentRunner(deps: AgentRunnerDependencies) {
  const active = new Map<AgentSessionId, ActiveRun>();
  const mcpUrl = new URL(deps.mcpUrl);
  mcpUrl.searchParams.delete("toolsets");

  function savedSession(run: ActiveRun): AgentSession {
    return structuredClone({ ...run.session, messages: redactMessages(run.session.messages, run.key) });
  }

  function authenticatedFetch(source: McpTokenSource, signal: AbortSignal): typeof fetch {
    return async (input, init) => {
      for (let attempt = 0; ; attempt++) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        headers.set("Authorization", `Bearer ${await source.token()}`);
        const signals = [signal, ...(init?.signal ? [init.signal] : [])];
        const response = await deps.fetch(input, { ...init, headers, credentials: "omit", redirect: "error", signal: AbortSignal.any(signals) });
        if (response.status !== 401 || attempt === 1) return response;
        await response.body?.cancel();
        source.invalidate();
      }
    };
  }

  async function drive(run: ActiveRun, provider: ReturnType<Providers["resolve"]>) {
    run.chat = null;
    let key = run.key;
    let client: Awaited<ReturnType<typeof createMCPClient>> | null = null;
    let token: McpTokenSource | null = null;
    let unsubscribe: (() => void) | undefined;
    let writeQueue = Promise.resolve();
    let lastPersisted = Date.now();
    let observedCount = run.session.messages.length;
    let closing = false;
    let persistenceError: unknown;
    let streamError: Error | undefined;
    const outputs = new Set(run.session.messages.flatMap((message) => message.parts
      .filter(isToolUIPart).filter((part) => ["output-available", "output-error", "output-denied"].includes(part.state))
      .map((part) => JSON.stringify([message.id, part.toolCallId]))));
    function snapshot(messages = run.chat?.messages ?? run.session.messages) {
      let newOutput = false;
      const now = new Date().toISOString();
      for (const message of messages) {
        for (const part of message.parts) {
          if (!isToolUIPart(part)) continue;
          const existing = Object.hasOwn(run.session.toolTimings, part.toolCallId)
            ? run.session.toolTimings[part.toolCallId] : undefined;
          const timing = existing ?? { startedAt: now, endedAt: null };
          if (!existing) run.session.toolTimings = { ...run.session.toolTimings, [part.toolCallId]: timing };
          if (!["output-available", "output-error", "output-denied"].includes(part.state)) continue;
          if (timing.endedAt === null) timing.endedAt = now;
          const callId = JSON.stringify([message.id, part.toolCallId]);
          if (outputs.has(callId)) continue;
          outputs.add(callId);
          newOutput = true;
          if (part.state === "output-available") {
            const name = part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
            const id = worktreeExtractors.get(name)?.(part.output);
            if (id && !run.session.worktreeIds.includes(id)) run.session.worktreeIds.push(id);
          }
        }
      }

      run.session = {
        ...run.session, updatedAt: new Date().toISOString(),
        messages,
      };
      deps.sessions.publish(run.session);
      return newOutput;
    }
    function persist() {
      const session = savedSession(run);
      lastPersisted = Date.now();
      writeQueue = writeQueue.then(() => deps.sessions.save(session)).catch((error: unknown) => {
        persistenceError = error;
        run.controller.abort();
      });
    }
    try {
      const resolved = await provider;
      key = run.key = resolved.apiKey;
      if (run.stopped) return;
      const model = createModel(resolved, run.session.model, deps.fetch, mcpUrl.origin);
      token = deps.createTokenSource(run.session.mode);
      client = await createMCPClient({ transport: { type: "http", url: mcpUrl.href, fetch: authenticatedFetch(token, run.controller.signal) } });
      const gated = gateTools(withStructuredContent(await client.tools()), run.session.mode, async (name, input, signal) => {
        const args = z.record(z.string(), z.unknown()).parse(input);
        const publishToken = deps.createTokenSource("publish");
        let publishClient: Awaited<ReturnType<typeof createMCPClient>> | undefined;
        try {
          publishClient = await createMCPClient({ transport: { type: "http", url: mcpUrl.href,
            fetch: authenticatedFetch(publishToken, run.controller.signal) } });
          return await publishClient.callTool({ name, arguments: args, options: signal ? { signal } : {} });
        } finally {
          try { await publishClient?.close(); } finally { await publishToken.dispose(); }
        }
      });
      let skill = "";
      try {
        const resource = await client.readResource({ uri: "skill://univer-workspace/core/SKILL.md" });
        skill = resource.contents.flatMap((content) => "text" in content ? [content.text] : []).join("\n");
      } catch { /* The core skill resource is optional on older gateways. */ }
      const agent = new ToolLoopAgent({
        ...model, ...gated, stopWhen: stepCountIs(50),
        onError({ error }) { streamError = new Error(redactProviderError(error, key)); },
        onStepEnd({ usage }) {
          const inputTokens = usage.inputTokens;
          const cacheReadTokens = usage.inputTokenDetails.cacheReadTokens;
          if (typeof inputTokens !== "number" || typeof cacheReadTokens !== "number") return;
          run.session = { ...run.session, cacheUsage: {
            inputTokens: run.session.cacheUsage.inputTokens + inputTokens,
            cacheReadTokens: run.session.cacheUsage.cacheReadTokens + cacheReadTokens,
            lastStep: { inputTokens, cacheReadTokens },
          } };
        },
        instructions: [client.instructions, skill, initialContextPrompt(run.session)].filter(Boolean).join("\n\n"),
      });
      run.session.messages = repairInterruptedTools(run.session.messages);
      const messages = run.session.messages.length
        ? await validateUIMessages<RuntimeMessage>({ messages: run.session.messages }) : [];
      let steering = false;
      const chat = new Chat<RuntimeMessage>({
        id: run.session.id, messages, transport: new DirectChatTransport({ agent, onError: (error) => redactProviderError(error, key) }),
        onError(error) { streamError = error; },
        onFinish({ isError, isDisconnect }) {
          if ((isError || isDisconnect) && !streamError) streamError = new Error("Agent stream ended unexpectedly");
        },
      });
      run.chat = chat;
      unsubscribe = chat["~registerMessagesCallback"](() => {
        if (closing) return;
        const added = chat.messages.slice(observedCount).some((message) => message.role === "user");
        const newOutput = snapshot();
        // A steering instruction is user input; save it before the model answers.
        if (added || Date.now() - lastPersisted >= 1000) persist();
        observedCount = chat.messages.length;
        const pendingTools = chat.messages.at(-1)?.parts.some((part) => isToolUIPart(part) &&
          (part.state === "input-streaming" || part.state === "input-available"));
        if (newOutput && !pendingTools && run.queued.length && !steering && !run.stopped) {
          steering = true;
          void chat.stop();
        }
      }, 100);
      if (run.stopped) return;
      let next: string | undefined;
      do {
        streamError = undefined;
        steering = false;
        if (chat.messages.length) chat.messages = await validateUIMessages<RuntimeMessage>({ messages: repairInterruptedTools(chat.messages) });
        if (next !== undefined) chat.messages = await validateUIMessages<RuntimeMessage>({ messages: appendUserMessage(chat.messages,
          { id: generateId(), role: "user", parts: [{ type: "text", text: next }] }) });
        await chat.sendMessage();
        if (streamError) throw streamError;
        next = !run.stopped && run.queued.length ? run.queued.splice(0).join("\n\n") : undefined;
      } while (next !== undefined && !run.stopped);
    } catch (error) {
      if (!run.stopped) {
        run.session = { ...run.session, status: transition(run.session.status, "fail"), error: redactProviderError(error, key) };
      }
    } finally {
      closing = true;
      unsubscribe?.();
      const cleanup = await Promise.allSettled([run.chat?.dispose(), client?.close(), token?.dispose()]);
      const failure = cleanup.find((result) => result.status === "rejected");
      if (run.session.status === "running") {
        run.session = failure?.status === "rejected" || persistenceError
          ? { ...run.session, status: transition(run.session.status, "fail"), error: redactProviderError(persistenceError ?? (failure?.status === "rejected" ? failure.reason : "Cleanup failed"), key) }
          : { ...run.session, status: transition(run.session.status, run.stopped ? "stop" : "finish"), error: null };
      }
      if ((run.session.status === "failed" || run.session.status === "stopped") && run.queued.length) {
        const message: RuntimeMessage = { id: generateId(), role: "user", parts: [{ type: "text", text: run.queued.splice(0).join("\n\n") }] };
        if (run.chat) run.chat.messages = await validateUIMessages<RuntimeMessage>({ messages: appendUserMessage(run.chat.messages, message) });
        else run.session.messages = appendUserMessage(run.session.messages, message);
      }
      snapshot(redactMessages(run.chat?.messages ?? run.session.messages, key));
      persist();
      await writeQueue;
    }
  }

  function launch(session: AgentSession, action:
    | { kind: "message"; text: string; settings?: AgentSettings; references?: AgentReference[] }
    | Extract<ApprovalSettlement, { kind: "decide" }>,
  ): Promise<AgentSession> {
    return new Promise((resolve, reject) => {
      const completion = deps.locks.request(sessionLockName(session.id), { ifAvailable: true }, async (lock) => {
        if (!lock) throw new AgentBusyError(session.id);
        session = await deps.sessions.get(session.id) ?? session;
        if (action.kind === "decide") {
          const messages = settleApprovals(session.messages, action);
          const resuming = ["interrupted", "stopped", "failed"].includes(session.status) &&
            session.messages.at(-1)?.parts.some((part) => isToolUIPart(part) && part.state === "approval-responded" &&
              part.approval.id === action.approvalId && part.approval.approved === action.approved);
          if (messages === session.messages && !resuming) { resolve(session); return; }
          session = { ...session, messages, updatedAt: new Date().toISOString() };
          if (!lastAssistantMessageIsCompleteWithApprovalResponses({ messages })) {
            await deps.sessions.save(session);
            resolve(session);
            return;
          }
        }
        const settings = action.kind === "message" ? action.settings : undefined;
        const references = action.kind === "message" ? action.references ?? [] : [];
        const reminder = settings ? settingsReminder(session, settings) : null;
        const attached = referencesReminder(references);
        const message: RuntimeMessage = { id: generateId(), role: "user", metadata: { agentContextPrompt: initialContextPrompt(session), ...(references.length ? { agentReferences: references } : {}) },
          parts: [{ type: "text", text: action.kind === "message" ? action.text : "" }, ...(reminder ? [{ type: "text" as const, text: reminder }] : []), ...(attached ? [attached] : [])] };
        const worktreeIds = [...session.worktreeIds];
        if (settings?.scope.kind === "repository" && settings.scope.baseWorktreeId && !worktreeIds.includes(settings.scope.baseWorktreeId)) worktreeIds.push(settings.scope.baseWorktreeId);
        const run: ActiveRun = { session: { ...session, ...(settings ? { scope: settings.scope, mode: settings.mode, model: settings.model } : {}), worktreeIds, status: transition(session.status, "send"), error: null,
          messages: action.kind === "message" ? appendUserMessage(repairInterruptedTools(session.messages), message) : repairInterruptedTools(session.messages),
          updatedAt: new Date().toISOString() }, chat: null, key: "",
          queued: [], stopped: false, controller: new AbortController(), completion: Promise.resolve() };
        active.set(session.id, run);
        try {
          const provider = deps.providers.resolve(run.session.model.providerId);
          // drive reports resolution failures as failed sessions after the initial save.
          run.key = await provider.then(({ apiKey }) => apiKey, () => "");
          await deps.sessions.save(savedSession(run));
          run.completion = completion;
          resolve(structuredClone(run.session));
          do {
            await drive(run, provider);
            if (run.stopped || run.session.status !== "idle" || !run.queued.length) break;
            const text = run.queued.splice(0).join("\n\n");
            run.session = { ...run.session, status: transition(run.session.status, "send"), error: null,
              messages: appendUserMessage(run.session.messages, { id: generateId(), role: "user", parts: [{ type: "text", text }] }) };
            await deps.sessions.save(savedSession(run));
          } while (true);
        } finally { active.delete(session.id); }
      }).then(() => undefined);
      completion.catch(reject);
    });
  }
  return {
    async start(input: StartAgentInput): Promise<AgentSession> {
      const now = new Date().toISOString();
      return launch({
        id: agentSessionIdSchema.parse(generateId()), userId: deps.userId, scope: input.scope, mode: input.mode, model: input.model,
        status: "idle", worktreeIds: input.scope.kind === "repository" && input.scope.baseWorktreeId ? [input.scope.baseWorktreeId] : [],
        messages: [], toolTimings: {}, cacheUsage: { inputTokens: 0, cacheReadTokens: 0, lastStep: null }, createdAt: now, updatedAt: now, error: null,
      }, { kind: "message", text: input.text, ...(input.references ? { references: input.references } : {}) });
    },
    async send(id: AgentSessionId, text: string, settings?: AgentSettings): Promise<AgentSession> {
      const running = active.get(id);
      if (running?.session.status === "running" && !running.stopped) {
        if (settings && !sameSettings(running.session, settings)) throw new Error("Settings can change after the current run ends");
        running.queued.push(text);
        return structuredClone(running.session);
      }
      if (running) await running.completion;
      const session = await deps.sessions.get(id);
      if (!session) throw new Error("Agent session not found");
      return launch(session, { kind: "message", text, ...(settings ? { settings } : {}) });
    },
    async decide(id: AgentSessionId, approvalId: string, approved: boolean): Promise<AgentSession> {
      if (active.has(id)) throw new AgentBusyError(id);
      const session = await deps.sessions.get(id);
      if (!session) throw new Error("Agent session not found");
      return launch(session, { kind: "decide", approvalId, approved });
    },
    async stop(id: AgentSessionId): Promise<void> {
      const run = active.get(id);
      if (!run) return;
      run.stopped = true;
      run.controller.abort();
      await run.chat?.stop();
      await run.completion;
    },
    isRunningHere(id: AgentSessionId) { return active.has(id); },
  };
}
export type AgentRunner = ReturnType<typeof createAgentRunner>;
