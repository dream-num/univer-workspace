import { dynamicTool, jsonSchema } from "ai";
import type { UIMessage } from "ai";
import { expect, it } from "vitest";
import { redactMessages, repairInterruptedTools, withStructuredContent } from "./messages";

it("repairs every unfinished assistant tool state while preserving completed parts", () => {
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
  for (const part of repaired[0]!.parts.slice(0, 5)) {
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

it("shows the model a tool's structured content next to its summary text", async () => {
  const contentOnly = dynamicTool({
    inputSchema: jsonSchema({ type: "object" }),
    execute: async () => ({}),
    toModelOutput: ({ output }) => ({
      type: "content",
      value: (output as { content: { text: string }[] }).content.map((part) => ({ type: "text" as const, text: part.text })),
    }),
  });
  const wrapped = withStructuredContent({ whoami: contentOnly }).whoami!;
  const shown = await wrapped.toModelOutput!({
    toolCallId: "1",
    input: {},
    output: { content: [{ type: "text", text: "whoami completed." }], structuredContent: { subject: { name: "Ada" } } },
  });
  expect(shown).toEqual({ type: "content", value: [
    { type: "text", text: "whoami completed." },
    { type: "text", text: '{"subject":{"name":"Ada"}}' },
  ] });
  const plain = await wrapped.toModelOutput!({ toolCallId: "2", input: {}, output: { content: [{ type: "text", text: "done" }] } });
  expect(plain).toEqual({ type: "content", value: [{ type: "text", text: "done" }] });
});
