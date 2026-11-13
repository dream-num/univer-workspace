import type { UIMessage } from "ai";
import { expect, it } from "vitest";
import { describeApproval, pendingApprovals, resumableApprovalResponse } from "./approvals";
import { session } from "./test-helpers";

const request: UIMessage = { id: "assistant", role: "assistant", parts: [
  { type: "dynamic-tool", toolName: "blob_upload", toolCallId: "call", state: "approval-requested", input: { name: "File", repo: "repo", upload_id: "upload" }, approval: { id: "approval" } },
] };

it("derives pending requests only when the run is no longer running", () => {
  expect(pendingApprovals(session({ messages: [request] }))).toEqual([{
    approvalId: "approval", toolCallId: "call", toolName: "blob_upload",
    action: { kind: "other", input: { name: "File", repo: "repo", upload_id: "upload" } },
  }]);
  expect(pendingApprovals(session({ status: "running", messages: [request] }))).toEqual([]);
});

it("describes publication inputs without making policy", () => {
  const input = { name: "Page", space: "s", upload_id: "upload" };
  expect(describeApproval(input)).toEqual({ kind: "other", input });
  expect(describeApproval({})).toEqual({ kind: "other", input: {} });
});

it("reads static tool approvals and ignores earlier messages or non-assistant messages", () => {
  const message: UIMessage = { id: "static", role: "assistant", parts: [
    { type: "tool-blob_replace", toolCallId: "replace", state: "approval-requested", input: { resource: "r", upload_id: "upload", etag: "v1" }, approval: { id: "replace-approval" } },
  ] };
  expect(pendingApprovals(session({ messages: [message] }))).toEqual([{
    approvalId: "replace-approval", toolCallId: "replace", toolName: "blob_replace",
    action: { kind: "other", input: { resource: "r", upload_id: "upload", etag: "v1" } },
  }]);
  expect(pendingApprovals(session({ messages: [] }))).toEqual([]);
  expect(pendingApprovals(session({ messages: [request, { id: "user", role: "user", parts: [] }] }))).toEqual([]);
});

const approved: UIMessage["parts"][number] = {
  type: "dynamic-tool", toolName: "blob_upload", toolCallId: "call", state: "approval-responded",
  input: {}, approval: { id: "approved", approved: true },
};

it.each(["interrupted", "stopped", "failed"] as const)("retains an approved decision for Continue after %s", (status) => {
  const saved = session({ status, messages: [{ id: "assistant", role: "assistant", parts: [approved] }] });
  expect(resumableApprovalResponse(saved.messages)).toEqual({ id: "approved", approved: true });
});

it("retains rejected decisions and static tool responses", () => {
  const rejected: UIMessage = { id: "assistant", role: "assistant", parts: [
    { type: "tool-blob_upload", toolCallId: "call", state: "approval-responded", input: {}, approval: { id: "rejected", approved: false } },
  ] };
  expect(resumableApprovalResponse([rejected])).toEqual({ id: "rejected", approved: false });
});

it.each<UIMessage["parts"][number]>([
  request.parts[0]!,
  { type: "dynamic-tool", toolName: "other", toolCallId: "other", state: "input-streaming" },
  { type: "tool-other", toolCallId: "other", state: "input-available", input: {} },
  { type: "tool-other", toolCallId: "other", state: "output-available", input: {}, output: "draft", preliminary: true },
])("does not resume while a last-step tool is $state", (part) => {
  expect(resumableApprovalResponse([{ id: "assistant", role: "assistant", parts: [approved, part] }])).toBeUndefined();
});

it("allows completed outputs alongside a response", () => {
  const parts: UIMessage["parts"] = [approved,
    { type: "tool-other", toolCallId: "done", state: "output-available", input: {}, output: "done" },
    { type: "tool-other", toolCallId: "failed", state: "output-error", input: {}, errorText: "failed" },
    { type: "tool-other", toolCallId: "denied", state: "output-denied", input: {}, approval: { id: "denied", approved: false } },
  ];
  expect(resumableApprovalResponse([{ id: "assistant", role: "assistant", parts }])).toEqual({ id: "approved", approved: true });
});

it("requires a response in the last assistant step", () => {
  expect(resumableApprovalResponse([])).toBeUndefined();
  expect(resumableApprovalResponse([{ id: "user", role: "user", parts: [approved] }])).toBeUndefined();
  expect(resumableApprovalResponse([{ id: "assistant", role: "assistant", parts: [{ type: "text", text: "done" }] }])).toBeUndefined();
  expect(resumableApprovalResponse([{ id: "assistant", role: "assistant", parts: [approved, { type: "step-start" }] }])).toBeUndefined();
  expect(resumableApprovalResponse([{ id: "assistant", role: "assistant", parts: [request.parts[0]!, { type: "step-start" }, approved] }]))
    .toEqual({ id: "approved", approved: true });
});
