import { $applyNodeReplacement, $getRoot, $isElementNode, DecoratorNode } from "lexical";
import type { LexicalNode, NodeKey, SerializedLexicalNode } from "lexical";
import type { ReactNode } from "react";
import { agentReferenceKey, agentReferenceSchema, agentReferenceToken } from "../agent.types";
import type { AgentReference } from "../agent.types";
import { AgentReferencePill } from "./references";

type SerializedReferenceNode = SerializedLexicalNode & { reference: AgentReference };
export class ReferenceNode extends DecoratorNode<ReactNode> {
  __reference: AgentReference;
  constructor(reference: AgentReference, key?: NodeKey) { super(key); this.__reference = reference; }
  static override getType(): string { return "agent-reference"; }
  static override clone(node: ReferenceNode): ReferenceNode { return new ReferenceNode(node.__reference, node.__key); }
  static override importJSON(value: SerializedReferenceNode): ReferenceNode { return $createReferenceNode(agentReferenceSchema.parse(value.reference)); }
  override exportJSON(): SerializedReferenceNode { return { ...super.exportJSON(), reference: this.__reference }; }
  getReference(): AgentReference { return this.getLatest().__reference; }
  override getTextContent(): string { return agentReferenceToken(this.getReference()); }
  override isInline(): boolean { return true; }
  override isKeyboardSelectable(): boolean { return false; }
  override createDOM(): HTMLElement { const element = document.createElement("span"); element.contentEditable = "false"; return element; }
  override updateDOM(): boolean { return false; }
  override decorate(): ReactNode { return <AgentReferencePill reference={this.getReference()} />; }
}
export function $createReferenceNode(reference: AgentReference): ReferenceNode { return $applyNodeReplacement(new ReferenceNode(reference)); }
export function $serializeComposer(): { text: string; references: AgentReference[] } {
  const references = new Map<string, AgentReference>();
  function visit(node: LexicalNode) {
    if (node instanceof ReferenceNode) { const reference = node.getReference(); if (!references.has(agentReferenceKey(reference))) references.set(agentReferenceKey(reference), reference); }
    else if ($isElementNode(node)) node.getChildren().forEach(visit);
  }
  visit($getRoot());
  return { text: $getRoot().getTextContent(), references: [...references.values()] };
}
