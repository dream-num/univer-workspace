/** Local prompt request validation for the DSH alpha.4 Session Remote. */

import type { SessionId } from "@deepseek-ai/dsh-session/types";

export type PromptContentPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly mediaType: string;
      readonly data: string;
      readonly name?: string;
    };

export interface SessionPromptRequest {
  readonly requestId?: string;
  readonly sessionId: SessionId;
  readonly mode: "queue" | "steer";
  readonly content: PromptContentPart[];
}

interface ParseSuccess {
  readonly success: true;
  readonly data: SessionPromptRequest;
}

interface ParseFailure {
  readonly success: false;
  readonly error: { readonly message: string };
}

function isPromptContentPart(value: unknown): value is PromptContentPart {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.type === "text") return typeof item.text === "string";
  return (
    item.type === "image" &&
    typeof item.mediaType === "string" &&
    typeof item.data === "string" &&
    (item.name === undefined || typeof item.name === "string")
  );
}

/** Minimal schema shape consumed by the local HTTP route. */
export const sessionPromptRequestSchema = {
  safeParse(value: unknown): ParseSuccess | ParseFailure {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { success: false, error: { message: "prompt request must be an object" } };
    }
    const item = value as Record<string, unknown>;
    if (typeof item.sessionId !== "string" || item.sessionId === "") {
      return { success: false, error: { message: "sessionId must be a non-empty string" } };
    }
    if (item.mode !== "queue" && item.mode !== "steer") {
      return { success: false, error: { message: "mode must be queue or steer" } };
    }
    if (!Array.isArray(item.content) || !item.content.every(isPromptContentPart)) {
      return { success: false, error: { message: "content must contain text or image parts" } };
    }
    return {
      success: true,
      data: { sessionId: item.sessionId as SessionId, mode: item.mode, content: item.content },
    };
  },
};
