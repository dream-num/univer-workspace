import { describe, expect, it } from "vitest";
import { agentReferenceSchema, messageReferences, sessionTitle, splitReferenceText } from "../agent.types";
import type { AgentReference } from "../agent.types";
import { session } from "../test-helpers";
import { referenceTrigger } from "./references";

describe("Agent references", () => {
  const issue: AgentReference = { kind: "issue", spaceId: "repo-1", repository: "verify/refs-team", number: 7, label: "Fix totals" };
  it("opens only for an @ at the caret after whitespace or at the start", () => {
    expect(referenceTrigger("@", 1)).toBe(0);
    expect(referenceTrigger("Read @ please", 6)).toBe(5);
    expect(referenceTrigger("Read\n@", 6)).toBe(5);
    expect(referenceTrigger("name@example.com", 5)).toBeNull();
    expect(referenceTrigger("请看@", 3)).toBe(2);
    expect(referenceTrigger("(＠", 2)).toBe(1);
    expect(referenceTrigger("@word", 5)).toBeNull();
    expect(referenceTrigger("", 0)).toBeNull();
  });
  it("restores inline references in place and leaves ordinary text untouched", () => {
    const first: AgentReference = { ...issue, number: 1 };
    const pull: AgentReference = { ...issue, kind: "pr", number: 3 };
    expect(splitReferenceText("请总结 @verify/refs-team#1 和 @verify/refs-team#3，并告诉我暗号。", [first, pull])).toEqual(["请总结 ", first, " 和 ", pull, "，并告诉我暗号。"]);
    expect(splitReferenceText("plain @text", [])).toEqual(["plain @text"]);
    expect(splitReferenceText("plain text", [first])).toEqual(["plain text"]);
    expect(sessionTitle(session({ messages: [{ id: "m1", role: "user", metadata: { agentReferences: [first, pull] },
      parts: [{ type: "text", text: "请总结@verify/refs-team#1 和@verify/refs-team#3 ，并告诉我暗号。" }] }] }))).toBe("请总结#1 Fix totals 和#3 Fix totals ，并告诉我暗号。");
  });
  it("matches the longest literal token first, including regex punctuation", () => {
    const first: AgentReference = { ...issue, repository: "a.b/repo+", number: 1 };
    const tenth: AgentReference = { ...first, number: 10 };
    const repo: AgentReference = { kind: "space", spaceId: first.spaceId, label: first.repository };
    expect(splitReferenceText("@a.b/repo+#10 @a.b/repo+#1 @a.b/repo+", [repo, first, tenth])).toEqual([tenth, " ", first, " ", repo]);
  });
  it("ignores invalid stored metadata and only restores reference IDs and labels", () => {
    expect(messageReferences({ agentContextPrompt: "context", agentReferences: [issue] })).toEqual([issue]);
    expect(messageReferences({ agentReferences: [{ ...issue, content: "not stored" }] })).toEqual([issue]);
    for (const metadata of [undefined, null, {}, { agentReferences: "issue" }, { agentReferences: [{ ...issue, number: 0 }] }, { agentReferences: [issue, { kind: "file" }] }]) expect(messageReferences(metadata)).toEqual([]);
    for (const number of [-1, 0, 1.5]) expect(agentReferenceSchema.safeParse({ ...issue, number }).success).toBe(false);
    expect(agentReferenceSchema.safeParse({ ...issue, spaceId: "" }).success).toBe(false);
  });
});
