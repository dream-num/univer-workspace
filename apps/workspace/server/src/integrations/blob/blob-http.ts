import { ApplicationError } from "../../middleware/errors.js";

export function parseByteRange(
  value: string | undefined,
  byteSize: number
): { readonly start: number; readonly end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || byteSize === 0) {
    throw rangeNotSatisfiable();
  }
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      throw rangeNotSatisfiable();
    }
    start = Math.max(0, byteSize - suffix);
    end = byteSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : byteSize - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= byteSize ||
    end < start
  ) {
    throw rangeNotSatisfiable();
  }
  return { start, end: Math.min(end, byteSize - 1) };
}

export function contentDisposition(
  kind: "inline" | "attachment",
  filename: string
): string {
  const fallback = filename.replaceAll(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replaceAll(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function rangeNotSatisfiable(): ApplicationError {
  return new ApplicationError(
    "RANGE_NOT_SATISFIABLE",
    416,
    "The requested byte range is not satisfiable."
  );
}
