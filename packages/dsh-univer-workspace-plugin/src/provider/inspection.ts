/**
 * Build the stable content-inspection selectors shared by the host tool and
 * the headless runtime.  Keeping this adapter free of Cordis/Node services
 * makes the Office-compatible range grammar directly unit-testable.
 * @module dsh-univer-workspace-plugin/provider/inspection
 */

import type { ContentInspectionQuery } from "@univer-cli/content-inspection";

export type InspectableUnitType = "sheet" | "doc" | "slide" | "base" | "board";

/**
 * Convert an Office-style optional range into the public SDK query model.
 * `Sheet1!A1:D20` selects a named worksheet; an unqualified range selects
 * worksheet index zero.  Non-Sheet Units expose only their overview query.
 */
export function inspectionQuery(
  unitType: InspectableUnitType,
  range: string | undefined,
): ContentInspectionQuery {
  if (range !== undefined) {
    if (unitType !== "sheet") {
      throw new Error("range inspection requires a Sheet Unit");
    }
    const trimmed = range.trim();
    if (trimmed === "") throw new Error("inspection range must not be empty");
    const split = trimmed.lastIndexOf("!");
    const worksheet = split < 0
      ? { index: 0 as const }
      : { name: unquoteSheetName(trimmed.slice(0, split)) };
    const address = split < 0 ? trimmed : trimmed.slice(split + 1).trim();
    if (address === "") throw new Error("inspection range must not be empty");
    return { kind: "worksheet-range", ranges: [{ range: address, worksheet }] };
  }
  if (unitType === "sheet") return { kind: "workbook" };
  if (unitType === "doc") return { kind: "document" };
  if (unitType === "slide") return { kind: "presentation" };
  throw new Error(`Unit type ${unitType} does not support structured inspection`);
}

function unquoteSheetName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    const unquoted = trimmed.slice(1, -1).replace(/''/gu, "'");
    if (unquoted === "") throw new Error("inspection worksheet name must not be empty");
    return unquoted;
  }
  if (trimmed === "") throw new Error("inspection worksheet name must not be empty");
  return trimmed;
}
