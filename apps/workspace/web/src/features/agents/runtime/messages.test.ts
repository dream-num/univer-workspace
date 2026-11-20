import type { UIMessage } from "ai";
import { expect, it } from "vitest";
import { redactMessages, repairInterruptedTools } from "./messages";

it("repairs interrupted tool inputs while preserving approvals and completed parts", () => {
  const messages: UIMessage[] = [{ id: "a", role: "assistant", parts: [
    { type: "dynamic-tool", toolName: "tool", toolCallId: "1", state: "input-streaming" },
    { type: "dynamic-tool", toolName: "tool", toolCallId: "2", state: "input-available", input: {} },
    { type: "dynamic-tool", toolName: "tool", toolCallId: "3", state: "approval-requested", input: {}, approval: { id: "approve-3" } },
    { type: "dynamic-tool", toolName: "tool", toolCallId: "4", state: "approval-responded", input: {}, approval: { id: "approve-4", approved: true } },
    { type: "tool-static", toolCallId: "5", state: "input-streaming" },
    { type: "dynamic-tool", toolName: "tool", toolCallId: "6", state: "output-available", input: {}, output: { value: 1 } },
    { type: "dynamic-tool", toolName: "tool", toolCallId: "7", state: "output-error", input: {}, errorText: "Existing error" },
    { type: "dynamic-tool", toolName: "tool", toolCallId: "8", state: "output-denied", input: {}, approval: { id: "denied", approved: false } },
    { type: "text", text: "Keep this text" },
  ] }];
  const repaired = repairInterruptedTools(messages);
  expect(repaired[0]?.parts.slice(0, 5)).toEqual(expect.arrayContaining([
    expect.objectContaining({ toolCallId: "1", state: "output-error", errorText: expect.stringContaining("interrupted") }),
    expect.objectContaining({ toolCallId: "5", state: "output-error", errorText: expect.stringContaining("interrupted") }),
  ]));
  expect(repaired[0]?.parts.slice(2, 4)).toEqual(messages[0]?.parts.slice(2, 4));
  for (const part of [repaired[0]!.parts[0], repaired[0]!.parts[1], repaired[0]!.parts[4]]) {
    expect(part).toMatchObject({ errorText: expect.stringContaining("may or may not have taken effect") });
    expect(part).toMatchObject({ errorText: expect.stringContaining("check the current state before retrying") });
  }
  expect(repaired[0]?.parts.slice(5)).toEqual(messages[0]?.parts.slice(5));
  expect(messages[0]?.parts[0]).toMatchObject({ state: "input-streaming" });
});

it("redacts keys in provider text, tool results and metadata without mutating SDK messages", () => {
  const key = 'sk-"\\secret';
  const messages: UIMessage[] = [{ id: "a", role: "assistant", metadata: { echoed: key }, parts: [
    { type: "text", text: `Provider echoed ${key}` },
    { type: "dynamic-tool", toolName: "test", toolCallId: "call", state: "output-available", input: {}, output: { echoed: key } },
  ] }];
  expect(JSON.stringify(redactMessages(messages, key))).not.toContain(JSON.stringify(key).slice(1, -1));
  expect(messages[0]?.metadata).toEqual({ echoed: key });
});
