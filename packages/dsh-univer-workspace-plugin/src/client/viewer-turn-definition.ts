/**
 * The viewer turn-definition: projects the univer_ tool calls/results into a
 * replay-safe Turn log, and derives the "open the floating document window"
 * intent from a successful `univer_open` (trunk view) operation.
 *
 * The structured document descriptor the `univer_open` tool renders as JSON
 * is parsed back here; a successful open publishes a ViewerTarget the dock
 * renders.
 * @module dsh-univer-workspace-plugin/client/viewer-turn-definition
 */

import type {
  ConversationNodeDefinition,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { SessionEvent } from "@deepseek-ai/dsh-session/types";
import type { WorkspaceDocumentOpen } from "../shared/wire.ts";

/** A document open intent derived from a successful univer_open tool result. */
export interface ViewerOpenIntent {
  readonly unitId: string;
  readonly unitType: "sheet" | "doc" | "slide" | "board" | "base";
  readonly readOnly: boolean;
  readonly name: string;
}

interface ViewerTurnState {
  readonly turn: number;
  readonly intents: readonly ViewerOpenIntent[];
}

declare module "@deepseek-ai/dsh-client-runtime/client" {
  interface ConversationTurnDataMap {
    /** Structured viewer open intents for this Turn. */
    univerViewer: { readonly intents: readonly ViewerOpenIntent[] };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unitType(value: unknown): ViewerOpenIntent["unitType"] | undefined {
  return value === "sheet" || value === "doc" || value === "slide" || value === "board" || value === "base"
    ? value
    : undefined;
}

/** Extract the structured document descriptor from a univer_open result text. */
function openIntentOf(data: SessionEvent<"tool/result">["data"]): ViewerOpenIntent | null {
  if (data.error !== undefined || data.message.content[0].isError === true) return null;
  const text = data.message.content[0].content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(firstBrace));
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const unitId = typeof raw.unitId === "string" ? raw.unitId : undefined;
  const type = unitType(raw.unitType);
  const name = typeof raw.name === "string" ? raw.name : undefined;
  if (unitId === undefined || type === undefined || name === undefined) return null;
  return {
    unitId,
    unitType: type,
    readOnly: raw.editorMode === "readOnly",
    name,
  };
}

/** Project univer_open results into a replay-safe viewer intent log. */
export const viewerTurnDefinition = {
  kind: "univerViewer",
  match(event: SessionEvent) {
    if (event.type === "turn/start") return { id: String(event.data.turn), role: "start" };
    if (event.type === "tool/result") return { id: String(event.data.turn), role: "update" };
    return null;
  },
  start(_context, match): ViewerTurnState {
    if (match.event.type !== "turn/start") throw new Error("viewer turn start match must be turn/start");
    return { turn: match.event.data.turn, intents: [] };
  },
  update(context, match): ViewerTurnState {
    if (match.event.type !== "tool/result") return context.state;
    const toolCallId = match.event.data.message.content[0].toolCallId;
    // Only univer_open results open a viewer. The tool name is not on the
    // result event; the intent is derived from the structured payload shape.
    const intent = openIntentOf(match.event.data);
    if (intent === null) return context.state;
    void toolCallId;
    if (context.state.intents.some((entry) => entry.unitId === intent.unitId)) return context.state;
    return { ...context.state, intents: [...context.state.intents, intent] };
  },
  buildLocationData(context, scope) {
    if (scope !== "turn" || context.state === undefined) return null;
    return { kind: "turn", turn: context.state.turn, key: "univerViewer", value: { intents: context.state.intents } };
  },
} satisfies ConversationNodeDefinition<ViewerTurnState>;
