import { describe, expect, it } from "vitest";
import { agentReferenceSchema } from "../agent.types";
import type { AgentReference } from "../agent.types";
import { addReference, messageReferences, referenceTrigger } from "./references";

describe("Agent references", () => {
  const issue: AgentReference = { kind: "issue", spaceId: "repo-1", number: 7, label: "Fix totals" };
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
  it("deduplicates by kind, repository and number rather than label", () => {
    const references = [issue];
    expect(addReference(references, { ...issue, label: "Renamed" })).toBe(references);
    expect(addReference(references, { ...issue, spaceId: "repo-2" })).toHaveLength(2);
    expect(addReference(references, { ...issue, kind: "pr" })).toHaveLength(2);
    expect(addReference(references, { kind: "space", spaceId: "repo-1", label: "Reports" })).toHaveLength(2);
  });
  it("ignores invalid stored metadata and only restores reference IDs and labels", () => {
    expect(messageReferences({ agentContextPrompt: "context", agentReferences: [issue] })).toEqual([issue]);
    expect(messageReferences({ agentReferences: [{ ...issue, content: "not stored" }] })).toEqual([issue]);
    for (const metadata of [undefined, null, {}, { agentReferences: "issue" }, { agentReferences: [{ ...issue, number: 0 }] }, { agentReferences: [issue, { kind: "file" }] }]) expect(messageReferences(metadata)).toEqual([]);
    for (const number of [-1, 0, 1.5]) expect(agentReferenceSchema.safeParse({ ...issue, number }).success).toBe(false);
    expect(agentReferenceSchema.safeParse({ ...issue, spaceId: "" }).success).toBe(false);
  });
});
