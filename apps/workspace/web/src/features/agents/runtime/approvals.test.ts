import { dynamicTool, jsonSchema } from "ai";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { describeApproval, gateTools, pendingApprovals, settleApprovals, SUPERSEDED_APPROVAL } from "./approvals";
import { session } from "../test-helpers";

const request: UIMessage = { id: "assistant", role: "assistant", parts: [
  { type: "dynamic-tool", toolName: "html_view_create", toolCallId: "call", state: "approval-requested", input: { name: "Page", space: "repo", html: "<html/>" }, approval: { id: "approval" } },
] };

describe("scope-based tool approval", () => {
  it.each(["ask", "auto"] as const)("gates publish in %s without using the tool name", async (mode) => {
    const execute = vi.fn(async () => "original");
    const publish = vi.fn(async () => "published");
    const tool = { ...dynamicTool({ inputSchema: jsonSchema({ type: "object" }), execute }), _meta: { "univer.workspace/scope": "publish" } };
    const gated = gateTools({ unfamiliar: tool }, mode, publish);
    const status = await gated.toolApproval({ toolCall: { type: "tool-call", toolCallId: "1", toolName: "unfamiliar", input: {} },
      tools: gated.tools, toolsContext: undefined as never, runtimeContext: undefined as never, messages: [] });
    expect(status).toEqual(mode === "ask" ? { type: "denied", reason: expect.stringContaining("read-only") } : "user-approval");
    if (mode === "auto") {
      const signal = new AbortController().signal;
      await gated.tools.unfamiliar!.execute!({}, { toolCallId: "1", messages: [], abortSignal: signal, context: {} });
      expect(publish).toHaveBeenCalledExactlyOnceWith("unfamiliar", {}, signal);
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it("keeps a tool with no metadata and its original execute unchanged", () => {
    const tool = dynamicTool({ inputSchema: jsonSchema({ type: "object" }), execute: async () => "original" });
    expect(gateTools({ html_view_create: tool }, "auto", vi.fn()).tools.html_view_create).toBe(tool);
  });

  it("denies merge by scope", async () => {
    const tool = { ...dynamicTool({ inputSchema: jsonSchema({ type: "object" }) }), _meta: { "univer.workspace/scope": "worktree:merge" } };
    const gated = gateTools({ merge: tool }, "auto", vi.fn());
    expect(await gated.toolApproval({ toolCall: { type: "tool-call", toolCallId: "1", toolName: "merge", input: {} },
      tools: gated.tools, toolsContext: undefined as never, runtimeContext: undefined as never, messages: [] })).toMatchObject({ type: "denied" });
  });
});

it("derives pending requests only when the run is no longer running", () => {
  expect(pendingApprovals(session({ messages: [request] }))).toEqual([{
    approvalId: "approval", toolCallId: "call", toolName: "html_view_create",
    action: { kind: "create", name: "Page", spaceId: "repo", html: "<html/>" },
  }]);
  expect(pendingApprovals(session({ status: "running", messages: [request] }))).toEqual([]);
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

it("describes uploads, replacements and unfamiliar inputs without making policy", () => {
  expect(describeApproval("html_view_create", { name: "Page", space: "s", html_upload_id: "upload" })).toMatchObject({ kind: "create", html: null });
  expect(describeApproval("html_view_replace", { resource: "r", html: "draft", etag: "v1" })).toEqual({ kind: "replace", resourceId: "r", html: "draft", etag: "v1" });
  expect(describeApproval("html_view_create", {})).toEqual({ kind: "other", input: {} });
});
