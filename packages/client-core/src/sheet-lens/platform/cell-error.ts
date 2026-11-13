// The one rule for "is this snapshot cell an error", shared by lens (read, inspect) and engine (replay).
// It lives in platform because lens and engine may not import each other.
//
// Exchange-node imports a constant `<c t="e">#N/A</c>` as {v:'#N/A', t:4} (FORCE_STRING) and error-looking TEXT as
// {v:'#N/A', t:1} (U25, univer-pro#5902; the swap is upstream, the engine convention is the other way round).
// So without a formula an error literal is an error only when t is 4; with a formula the literal is the result.

/** Cell type that exchange-node gives a constant error literal. */
export const CONSTANT_ERROR_TYPE = 4;

interface CellLike {
  v?: unknown;
  t?: unknown;
  f?: unknown;
  si?: unknown;
}

const hasFormula = (c: CellLike): boolean =>
  Boolean(c.f) || (c.si !== undefined && c.si !== null && c.si !== "");

/** True for a formula result that is an error literal, or a constant error literal typed as an imported error. */
export function isErrorCell(
  cell: CellLike | null | undefined,
  isErrorLiteral: (v: string) => boolean,
): boolean {
  if (!cell || typeof cell.v !== "string" || !isErrorLiteral(cell.v)) return false;
  return hasFormula(cell) || cell.t === CONSTANT_ERROR_TYPE;
}
