import { expect, test } from "vitest";
import { WorkspaceApplicationError } from "../../src/errors.js";
import { SheetLensError } from "../../src/sheet-lens/platform/errors.js";

test.each([
  ["E_REF_NOT_FOUND", "workspace-sheet-lens-ref-not-found"],
  ["E_RANGE", "workspace-sheet-lens-range-invalid"],
  ["E_SHEET_NOT_FOUND", "workspace-sheet-lens-sheet-not-found"],
  ["E_USAGE", "workspace-argument-invalid"],
] as const)("%s uses the Workspace error contract", (code, expected) => {
  const error = new SheetLensError(code, "Lens failed");
  expect(error).toBeInstanceOf(WorkspaceApplicationError);
  expect(error.code).toBe(expected);
  expect(error.hint).not.toMatch(/\buxl\b/);
  expect(error.detail).toEqual({ hint: error.hint, details: [] });
});

test("error overrides retain hints, details, and cause", () => {
  const cause = new Error("cause");
  const error = new SheetLensError("E_RANGE", "invalid range", {
    hint: "narrow the range",
    details: ["A1:B2"],
    cause,
  });
  expect(error.message).toBe("invalid range");
  expect(error.cause).toBe(cause);
  expect(error.hint).toBe("narrow the range");
  expect(error.details).toEqual(["A1:B2"]);
  expect(error.detail).toEqual({ hint: "narrow the range", details: ["A1:B2"] });
});
