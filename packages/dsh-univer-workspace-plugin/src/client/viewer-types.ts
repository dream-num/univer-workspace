/** Lightweight Viewer type/support contract, safe to import from tests and UI shells. */

export type ViewerUnitType = "sheet" | "doc" | "slide" | "board" | "base";

/** Unit types for which the embedded browser bundle has a complete preset stack. */
export const SUPPORTED_VIEWER_UNIT_TYPES = [
  "sheet",
  "doc",
  "slide",
  "base",
  "board",
] as const satisfies readonly ViewerUnitType[];

export function isViewerUnitTypeSupported(unitType: ViewerUnitType): boolean {
  return (SUPPORTED_VIEWER_UNIT_TYPES as readonly string[]).includes(unitType);
}
