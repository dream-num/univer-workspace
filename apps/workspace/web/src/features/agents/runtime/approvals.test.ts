import { dynamicTool, jsonSchema } from "ai";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { gateTools, settleApprovals, SUPERSEDED_APPROVAL } from "./approvals";

const request: UIMessage = { id: "assistant", role: "assistant", parts: [
  { type: "dynamic-tool", toolName: "blob_upload", toolCallId: "call", state: "approval-requested", input: { name: "File", repo: "repo", upload_id: "upload" }, approval: { id: "approval" } },
] };

describe("scope-based tool approval", () => {
  it.each(["ask", "auto"] as const)("gates blob uploads in %s by publish scope", async (mode) => {
    const execute = vi.fn(async () => "original");
    const publish = vi.fn(async () => "published");
    const tool = { ...dynamicTool({ inputSchema: jsonSchema({ type: "object" }), execute }), _meta: { "univer.workspace/scope": "publish" } };
    const gated = gateTools({ blob_upload: tool }, mode, publish);
    const status = await gated.toolApproval({ toolCall: { type: "tool-call", toolCallId: "1", toolName: "blob_upload", input: {} },
      tools: gated.tools, toolsContext: undefined as never, runtimeContext: undefined as never, messages: [] });
    expect(status).toEqual(mode === "ask" ? { type: "denied", reason: expect.stringContaining("read-only") } : "user-approval");
    if (mode === "auto") {
      const signal = new AbortController().signal;
      await gated.tools.blob_upload!.execute!({}, { toolCallId: "1", messages: [], abortSignal: signal, context: {} });
      expect(publish).toHaveBeenCalledExactlyOnceWith("blob_upload", {}, signal);
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it("keeps a tool with no metadata and its original execute unchanged", () => {
    const tool = dynamicTool({ inputSchema: jsonSchema({ type: "object" }), execute: async () => "original" });
    expect(gateTools({ html_view_create: tool }, "auto", vi.fn()).tools.html_view_create).toBe(tool);
  });

  it.each(["html_view_create", "html_view_replace"])("executes write-scope %s with the session client and no publish authority", async (toolName) => {
    const execute = vi.fn(async () => ({ structuredContent: { draft: { id: "draft-1" } } }));
    const publish = vi.fn();
    const tool = { ...dynamicTool({ inputSchema: jsonSchema({ type: "object" }), execute }), _meta: { "univer.workspace/scope": "write" } };
    const gated = gateTools({ [toolName]: tool }, "auto", publish);
    expect(await gated.toolApproval({ toolCall: { type: "tool-call", toolCallId: "page", toolName, input: {} },
      tools: gated.tools, toolsContext: undefined as never, runtimeContext: undefined as never, messages: [] })).toBe("not-applicable");
    expect(gated.tools[toolName]).toBe(tool);
    await gated.tools[toolName]!.execute!({}, { toolCallId: "page", messages: [], context: {} });
    expect(execute).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });

  it("denies merge by scope", async () => {
    const tool = { ...dynamicTool({ inputSchema: jsonSchema({ type: "object" }) }), _meta: { "univer.workspace/scope": "worktree:merge" } };
    const gated = gateTools({ merge: tool }, "auto", vi.fn());
    expect(await gated.toolApproval({ toolCall: { type: "tool-call", toolCallId: "1", toolName: "merge", input: {} },
      tools: gated.tools, toolsContext: undefined as never, runtimeContext: undefined as never, messages: [] })).toMatchObject({ type: "denied" });
  });
});

it("settles one decision without mutating history and ignores stale IDs", () => {
  const messages = [request];
  expect(settleApprovals(messages, { kind: "decide", approvalId: "stale", approved: true })).toBe(messages);
  const settled = settleApprovals(messages, { kind: "decide", approvalId: "approval", approved: true });
  expect(settled[0]?.parts[0]).toMatchObject({ state: "approval-responded", approval: { id: "approval", approved: true } });
  expect(request.parts[0]).toMatchObject({ state: "approval-requested" });
  expect(settleApprovals(settled, { kind: "decide", approvalId: "approval", approved: false })).toBe(settled);
});

it("denies open requests on a new message and interrupts approved calls without a result", () => {
  const settled = settleApprovals([request], { kind: "user-message" });
  expect(settled[0]?.parts[0]).toMatchObject({ state: "output-denied", approval: { approved: false, reason: SUPERSEDED_APPROVAL } });
  const approved = settleApprovals([request], { kind: "decide", approvalId: "approval", approved: true });
  expect(settleApprovals(approved, { kind: "user-message" })[0]?.parts[0]).toMatchObject({ state: "output-error", errorText: expect.stringContaining("may or may not have taken effect") });
  const denied = settleApprovals([request], { kind: "decide", approvalId: "approval", approved: false });
  expect(settleApprovals(denied, { kind: "user-message" })[0]?.parts[0]).toMatchObject({ state: "output-denied", approval: { approved: false } });
});
