import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { UniverError } from "./errors.ts";

/** Shared schema and presentation primitives for the document tools. */
export const unitTypeEnum = {
  type: "string" as const,
  enum: ["sheet", "doc", "slide", "board", "base"] as const,
};

export function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

export function nonEmptyArgument(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "")
    throw new UniverError(`univer_status ${name} must be non-empty.`, "INVALID_REQUEST");
  return trimmed;
}
