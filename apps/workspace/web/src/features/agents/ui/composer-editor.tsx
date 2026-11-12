import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, $isTextNode, $setSelection, COMMAND_PRIORITY_HIGH, INSERT_LINE_BREAK_COMMAND, KEY_DOWN_COMMAND, KEY_ENTER_COMMAND } from "lexical";
import type { LexicalEditor, RangeSelection } from "lexical";
import { useEffect, useRef } from "react";
import type { AgentReference } from "../agent.types";
import { $createReferenceNode, $serializeComposer, ReferenceNode } from "./reference-node";
import { referenceTrigger } from "./references";

export type ComposerEditorHandle = { editor: LexicalEditor; selection: RangeSelection | null };
type Props = {
  readonly handle: { current: ComposerEditorHandle | null }; readonly label: string; readonly busy: boolean;
  readonly starter?: { readonly text: string } | null; readonly focus?: boolean;
  readonly onChange: (content: ReturnType<typeof $serializeComposer>) => void;
  readonly onTrigger: (selection: RangeSelection) => void; readonly onSend: () => void; readonly onFocus: () => void;
};
export function insertComposerReference(handle: ComposerEditorHandle, reference: AgentReference, trigger: RangeSelection | null) {
  handle.editor.update(() => {
    const selection = trigger ?? handle.selection;
    if (selection) $setSelection(selection.clone()); else $getRoot().selectEnd();
    const current = $getSelection();
    if ($isRangeSelection(current)) {
      const space = $createTextNode(" ");
      current.insertNodes([$createReferenceNode(reference), space]);
      space.selectEnd();
    }
  });
  handle.editor.focus();
}
export function ComposerEditor(props: Props) {
  return <LexicalComposer initialConfig={{ namespace: "agent-composer", nodes: [ReferenceNode], onError: (error) => { throw error; } }}>
    <div className="agent-editor-container"><PlainTextPlugin ErrorBoundary={LexicalErrorBoundary}
      contentEditable={<ContentEditable id="agent-composer" className="agent-editor" aria-label={props.label} aria-multiline="true" onFocus={props.onFocus} />}
      placeholder={<span className="agent-editor-placeholder">{props.label}</span>} /></div>
    <HistoryPlugin />
    <EditorBehavior {...props} />
  </LexicalComposer>;
}
function EditorBehavior(props: Props) {
  const [editor] = useLexicalComposerContext();
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const handle: ComposerEditorHandle = { editor, selection: null };
    latest.current.handle.current = handle;
    const unregister = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => editorState.read(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) handle.selection = selection.clone();
      if (!dirtyElements.size && !dirtyLeaves.size) return;
      latest.current.onChange($serializeComposer());
      if (editor.isComposing() || !$isRangeSelection(selection) || !selection.isCollapsed()) return;
      const node = selection.anchor.getNode();
      if (!$isTextNode(node)) return;
      const offset = selection.anchor.offset;
      const trigger = referenceTrigger(node.getTextContent(), offset);
      if (trigger !== null) {
        const range = selection.clone();
        range.anchor.set(node.getKey(), trigger, "text");
        latest.current.onTrigger(range);
      }
    }));
    const unregisterEnter = editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
      if (!event || editor.isComposing() || event.isComposing || (event.shiftKey && !event.ctrlKey && !event.metaKey)) return false;
      event.preventDefault(); latest.current.onSend(); return true;
    }, COMMAND_PRIORITY_HIGH);
    const unregisterNewline = editor.registerCommand(KEY_DOWN_COMMAND, (event) => {
      if (editor.isComposing() || event.isComposing || !event.ctrlKey || event.key.toLowerCase() !== "j") return false;
      event.preventDefault(); editor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false); return true;
    }, COMMAND_PRIORITY_HIGH);
    return () => { unregister(); unregisterEnter(); unregisterNewline(); latest.current.handle.current = null; };
  }, [editor]);
  useEffect(() => { editor.setEditable(!props.busy); }, [editor, props.busy]);
  useEffect(() => {
    if (props.starter) {
      const text = props.starter.text;
      editor.update(() => { const root = $getRoot(); root.clear(); root.append($createParagraphNode().append($createTextNode(text))); root.selectEnd(); });
      editor.focus();
    }
  }, [editor, props.starter]);
  useEffect(() => { if (props.focus) editor.focus(); }, [editor, props.focus]);
  return null;
}
