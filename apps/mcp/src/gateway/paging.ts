import { createHash } from "node:crypto";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";

export const RESULT_LIMIT = 100_000;
// Room for the truncated and cursor members that a page adds after it was measured.
const PAGE_ENVELOPE = 512;

export const serializedLength = (value: unknown): number => JSON.stringify(value).length;
export const fitsPage = (value: unknown): boolean =>
  serializedLength(value) + PAGE_ENVELOPE <= RESULT_LIMIT;

const digest = (tool: string, args: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify([tool, args]))
    .digest("hex")
    .slice(0, 16);

const invalidCursor = () =>
  workspaceError(
    "workspace-argument-invalid",
    "cursor does not belong to this tool and these arguments. Repeat the first call without a cursor, or call again with the same arguments and the cursor it returned.",
  );

/** The cursor is stateless: it carries the next offset and a digest of the other arguments. */
export function encodeCursor(tool: string, args: unknown, offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset, d: digest(tool, args) })).toString("base64url");
}

export function decodeCursor(
  cursor: string | undefined,
  tool: string,
  args: unknown,
  total: number,
): number {
  if (cursor === undefined) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (typeof parsed !== "object" || parsed === null) throw invalidCursor();
  const { o, d } = parsed as { o?: unknown; d?: unknown };
  if (
    d !== digest(tool, args) ||
    typeof o !== "number" ||
    !Number.isInteger(o) ||
    o < 0 ||
    o > total
  ) {
    throw invalidCursor();
  }
  return o;
}

export function resultTooLarge(tool: string, advice: string) {
  return workspaceError(
    "workspace-result-too-large",
    `${tool} would return more than ${String(RESULT_LIMIT)} characters. ${advice}`,
  );
}

/** Pages `text` by character offset. `build` wraps one chunk in the tool's result envelope. */
export function pageText(
  tool: string,
  args: unknown,
  cursor: string | undefined,
  text: string,
  build: (chunk: string) => object,
): object {
  const start = decodeCursor(cursor, tool, args, text.length);
  let end = text.length;
  while (end > start && !fitsPage(build(text.slice(start, end)))) {
    end = start + Math.floor((end - start) * 0.8);
  }
  // Never split a surrogate pair.
  const last = text.charCodeAt(end - 1);
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
  if (end <= start && text.length > start) {
    throw resultTooLarge(tool, "The envelope alone does not fit.");
  }
  const page = build(text.slice(start, end));
  return end < text.length
    ? { ...page, truncated: true, cursor: encodeCursor(tool, args, end) }
    : page;
}
