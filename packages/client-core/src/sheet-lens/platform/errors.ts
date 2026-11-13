import { WorkspaceApplicationError } from "../../errors.js";

const ERRORS = {
  E_REF_NOT_FOUND: {
    code: "workspace-sheet-lens-ref-not-found",
    hint: "run outline on this Unit again to see its current refs; editing the Unit can renumber them",
  },
  E_RANGE: {
    code: "workspace-sheet-lens-range-invalid",
    hint: "write A1, A1:C20, A:C or 3:5, optionally preceded by Sheet!, for example Sheet1!A1:C20",
  },
  E_SHEET_NOT_FOUND: {
    code: "workspace-sheet-lens-sheet-not-found",
    hint: "run outline on this Unit to list its sheet names",
  },
  E_USAGE: {
    code: "workspace-argument-invalid",
    hint: "check the command's options and try again",
  },
} as const;

interface SheetLensErrorOptions {
  hint?: string;
  details?: string[];
  cause?: unknown;
}

export class SheetLensError extends WorkspaceApplicationError {
  public readonly hint: string;
  public readonly details: string[];

  public constructor(
    code: keyof typeof ERRORS,
    message: string,
    options: SheetLensErrorOptions = {},
  ) {
    const hint = options.hint ?? ERRORS[code].hint;
    const details = options.details ?? [];
    super(
      ERRORS[code].code,
      message,
      { hint, details },
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "SheetLensError";
    this.hint = hint;
    this.details = details;
  }
}
