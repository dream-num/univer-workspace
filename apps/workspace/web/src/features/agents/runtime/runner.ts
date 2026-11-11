import { createMCPClient } from "@ai-sdk/mcp";
import { Chat } from "@ai-sdk/react";
import { DirectChatTransport, ToolLoopAgent, generateId, isToolUIPart, stepCountIs, validateUIMessages } from "ai";
import type { ToolSet, UIMessage } from "ai";
import type { AgentMode, AgentScope, AgentSession, AgentSessionId } from "../agent.types";
import { agentSessionIdSchema, sessionLockName, transition } from "../agent.types";
import type { McpTokenSource } from "../mcp-token";
import type { Providers } from "../providers";
import { redactProviderError } from "../providers";
import type { SessionStore } from "../session-store";
import { createModel } from "./model";
import { redactMessages, repairInterruptedTools, withStructuredContent, worktreeExtractors } from "./messages";

type RuntimeMessage = UIMessage<unknown, never>;

export interface AgentRunnerDependencies {
  userId: string;
  fetch: typeof fetch;
  locks: LockManager;
  sessions: SessionStore;
  providers: Pick<Providers, "resolve">;
  createTokenSource(mode: AgentMode): McpTokenSource;
  mcpUrl: string;
}
export interface StartAgentInput {
  scope: AgentScope;
  mode: AgentMode;
  model: AgentSession["model"];
  text: string;
}
export class AgentBusyError extends Error {
  readonly code = "AGENT_BUSY";
  constructor(readonly sessionId: AgentSessionId) { super("This session is running in another tab"); }
}
interface ActiveRun {
  session: AgentSession;
  chat: Chat<RuntimeMessage> | null;
  queued: string[];
  stopped: boolean;
  controller: AbortController;
  completion: Promise<void>;
}

function contextPrompt(session: AgentSession): string {
  const scope = session.scope.kind === "global"
    ? "Global scope: find the target repository with repo_list or search."
    : `Work only in the repository whose Space ID is ${JSON.stringify(session.scope.spaceId)}; tools accept this ID as repo.`;
  const mode = session.mode === "ask" ? "Ask mode: read only. Never call a write tool."
    : session.scope.kind === "repository" && session.scope.baseWorktreeId
      ? `Auto mode: write only in the base pull request Worktree ${JSON.stringify(session.scope.baseWorktreeId)}.`
      : "Auto mode: put every write in one pull request. Call pr_create before the first write, and reuse that pull request for this session. Never merge; a person reviews and merges.";
  return `${scope}\n${mode}\nSession pull request Worktree IDs: ${JSON.stringify(session.worktreeIds)}.\nTool errors arrive as results for you to handle.`;
}

export function createAgentRunner(deps: AgentRunnerDependencies) {
  const active = new Map<AgentSessionId, ActiveRun>();
  const mcpUrl = new URL(deps.mcpUrl);
  mcpUrl.searchParams.delete("toolsets");

  async function drive(run: ActiveRun) {
    run.chat = null;
    let key = "";
    let client: Awaited<ReturnType<typeof createMCPClient>> | null = null;
    let token: McpTokenSource | null = null;
    let unsubscribe: (() => void) | undefined;
    let writeQueue = Promise.resolve();
    let lastPersisted = Date.now();
    let persistedCount = run.session.messages.length;
    let persistenceError: unknown;
    let streamError: Error | undefined;
    function snapshot() {
      run.session = {
        ...run.session, updatedAt: new Date().toISOString(),
        messages: redactMessages(run.chat?.messages ?? run.session.messages, key),
      };
      deps.sessions.publish(run.session);
    }
    function persist() {
      const session = structuredClone(run.session);
      lastPersisted = Date.now();
      writeQueue = writeQueue.then(() => deps.sessions.save(session)).catch((error: unknown) => {
        persistenceError = error;
        run.controller.abort();
      });
    }
    try {
      const provider = await deps.providers.resolve(run.session.model.providerId);
      key = provider.apiKey;
      if (run.stopped) return;
      const model = createModel(provider, run.session.model, deps.fetch, mcpUrl.origin);
      token = deps.createTokenSource(run.session.mode);
      const source = token;
      const authenticatedFetch: typeof fetch = async (input, init) => {
        for (let attempt = 0; ; attempt++) {
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          headers.set("Authorization", `Bearer ${await source.token()}`);
          const signals = [run.controller.signal, ...(init?.signal ? [init.signal] : [])];
          const response = await deps.fetch(input, { ...init, headers, credentials: "omit", redirect: "error", signal: AbortSignal.any(signals) });
          if (response.status !== 401 || attempt === 1) return response;
          await response.body?.cancel();
          source.invalidate();
        }
      };
      client = await createMCPClient({ transport: { type: "http", url: mcpUrl.href, fetch: authenticatedFetch } });
      const tools: ToolSet = withStructuredContent(await client.tools());
      let skill = "";
      try {
        const resource = await client.readResource({ uri: "skill://univer-workspace/core/SKILL.md" });
        skill = resource.contents.flatMap((content) => "text" in content ? [content.text] : []).join("\n");
      } catch { /* The core skill resource is optional on older gateways. */ }
      const agent = new ToolLoopAgent({
        ...model, tools, stopWhen: stepCountIs(50),
        onError({ error }) { streamError = new Error(redactProviderError(error, key)); },
        instructions: [client.instructions, skill, contextPrompt(run.session)].filter(Boolean).join("\n\n"),
      });
      run.session.messages = repairInterruptedTools(run.session.messages);
      const messages = run.session.messages.length
        ? await validateUIMessages<RuntimeMessage>({ messages: run.session.messages }) : [];
      let steering = false;
      const outputs = new Set(messages.flatMap((message) => message.parts
        .filter(isToolUIPart).filter((part) => ["output-available", "output-error", "output-denied"].includes(part.state))
        .map((part) => JSON.stringify([message.id, part.toolCallId]))));
      const chat = new Chat<RuntimeMessage>({
        id: run.session.id, messages, transport: new DirectChatTransport({ agent, onError: (error) => redactProviderError(error, key) }),
        onError(error) { streamError = error; },
        onFinish({ isError, isDisconnect }) {
          if ((isError || isDisconnect) && !streamError) streamError = new Error("Agent stream ended unexpectedly");
        },
      });
      run.chat = chat;
      unsubscribe = chat["~registerMessagesCallback"](() => {
        let newOutput = false;
        const now = new Date().toISOString();
        for (const message of chat.messages) {
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
        const added = chat.messages.length !== persistedCount && chat.messages.at(-1)?.role === "user";
        snapshot();
        // A steering instruction is user input; save it before the model answers.
        if (added || Date.now() - lastPersisted >= 1000) persist();
        persistedCount = chat.messages.length;
        const pendingTools = chat.messages.at(-1)?.parts.some((part) => isToolUIPart(part) &&
          (part.state === "input-streaming" || part.state === "input-available"));
        if (newOutput && !pendingTools && run.queued.length && !steering && !run.stopped) {
          steering = true;
          void chat.stop();
        }
      });
      if (run.stopped) return;
      let next: string | undefined;
      do {
        streamError = undefined;
        steering = false;
        if (chat.messages.length) chat.messages = await validateUIMessages<RuntimeMessage>({ messages: repairInterruptedTools(chat.messages) });
        await chat.sendMessage(next === undefined ? undefined : { text: next });
        if (streamError) throw streamError;
        next = !run.stopped && run.queued.length ? run.queued.splice(0).join("\n\n") : undefined;
      } while (next !== undefined && !run.stopped);
    } catch (error) {
      if (!run.stopped) {
        run.session = { ...run.session, status: transition(run.session.status, "fail"), error: redactProviderError(error, key) };
      }
    } finally {
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
        if (run.chat) run.chat.messages = [...run.chat.messages, message];
        else run.session.messages = [...run.session.messages, message];
      }
      snapshot();
      persist();
      await writeQueue;
    }
  }

  function launch(session: AgentSession, text: string): Promise<AgentSession> {
    return new Promise((resolve, reject) => {
      const completion = deps.locks.request(sessionLockName(session.id), { ifAvailable: true }, async (lock) => {
        if (!lock) throw new AgentBusyError(session.id);
        session = await deps.sessions.get(session.id) ?? session;
        const run: ActiveRun = { session: { ...session, status: transition(session.status, "send"), error: null,
          messages: [...repairInterruptedTools(session.messages), { id: generateId(), role: "user", parts: [{ type: "text", text }] }],
          updatedAt: new Date().toISOString() }, chat: null,
          queued: [], stopped: false, controller: new AbortController(), completion: Promise.resolve() };
        active.set(session.id, run);
        try {
          await deps.sessions.save(run.session);
          run.completion = completion;
          resolve(structuredClone(run.session));
          do {
            await drive(run);
            if (run.stopped || run.session.status !== "idle" || !run.queued.length) break;
            const text = run.queued.splice(0).join("\n\n");
            run.session = { ...run.session, status: transition(run.session.status, "send"), error: null,
              messages: [...run.session.messages, { id: generateId(), role: "user", parts: [{ type: "text", text }] }] };
            await deps.sessions.save(run.session);
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
        messages: [], toolTimings: {}, createdAt: now, updatedAt: now, error: null,
      }, input.text);
    },
    async send(id: AgentSessionId, text: string): Promise<AgentSession> {
      const running = active.get(id);
      if (running?.session.status === "running" && !running.stopped) {
        running.queued.push(text);
        return structuredClone(running.session);
      }
      if (running) await running.completion;
      const session = await deps.sessions.get(id);
      if (!session) throw new Error("Agent session not found");
      return launch(session, text);
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
