export type WorkspaceReferenceProviderErrorCode =
  | "aborted"
  | "invalid-host-context"
  | "invalid-load-context"
  | "invalid-unit-id"
  | "loaded-identity-mismatch"
  | "loaded-type-mismatch"
  | "unit-type-mismatch"
  | "unsupported-file-kind"
  | "unsupported-unit-type";

export class WorkspaceReferenceProviderError extends Error {
  public readonly code: WorkspaceReferenceProviderErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;
  public readonly retryable = false;

  public constructor(
    code: WorkspaceReferenceProviderErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "WorkspaceReferenceProviderError";
    this.code = code;
    this.details = details;
  }
}
