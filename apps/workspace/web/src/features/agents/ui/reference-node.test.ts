import { $isElementNode, $createLineBreakNode, $createParagraphNode, $createTextNode, $getRoot, createEditor } from "lexical";
import { describe, expect, it } from "vitest";
import type { AgentReference } from "../agent.types";
import { $createReferenceNode, $serializeComposer, ReferenceNode } from "./reference-node";

const issue: AgentReference = { kind: "issue", spaceId: "repo-1", repository: "verify/refs-team", number: 1, label: "Travel budget review" };
const pull: AgentReference = { ...issue, kind: "pr", number: 3, label: "Budget changes" };
function serialize(parts: (string | AgentReference)[]) {
  const editor = createEditor({ namespace: "test", nodes: [ReferenceNode], onError: (error) => { throw error; } });
  editor.update(() => {
    $getRoot().append($createParagraphNode().append(...parts.map((part) => typeof part === "string" ? $createTextNode(part) : $createReferenceNode(part))));
  }, { discrete: true });
  return { editor, content: editor.getEditorState().read($serializeComposer) };
}
describe("inline composer references", () => {
  it("serializes real inline nodes at their positions with deduplicated references in document order", () => {
    expect(serialize(["请总结 ", issue, " 和 ", pull, "，并告诉我暗号。"]).content).toEqual({
      text: "请总结 @verify/refs-team#1 和 @verify/refs-team#3，并告诉我暗号。", references: [issue, pull],
    });
    const { editor } = serialize([pull, issue, { ...pull, label: "Renamed" }]);
    expect(editor.getEditorState().read($serializeComposer).references).toEqual([pull, issue]);
    editor.update(() => { const paragraph = $getRoot().getFirstChildOrThrow(); if ($isElementNode(paragraph)) paragraph.getLastChildOrThrow().remove(); }, { discrete: true });
    expect(editor.getEditorState().read($serializeComposer)).toEqual({ text: "@verify/refs-team#3@verify/refs-team#1", references: [pull, issue] });
  });
  it("round-trips reference JSON and counts a pill-only prompt as text", () => {
    const { editor, content } = serialize([issue]);
    expect(content.text.trim()).toBe("@verify/refs-team#1");
    editor.setEditorState(editor.parseEditorState(JSON.stringify(editor.getEditorState().toJSON())));
    expect(editor.getEditorState().read($serializeComposer)).toEqual(content);
  });
  it("preserves plain text and line breaks without references", () => {
    const { editor } = serialize(["First"]);
    editor.update(() => { $getRoot().getFirstChildOrThrow().insertAfter($createParagraphNode().append($createTextNode("Second"), $createLineBreakNode(), $createTextNode("Third"))); }, { discrete: true });
    expect(editor.getEditorState().read($serializeComposer)).toEqual({ text: "First\n\nSecond\nThird", references: [] });
  });
});
