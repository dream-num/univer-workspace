export class WorkspaceApplicationError extends Error {
  public readonly code: string;
  public readonly detail: unknown;

  public constructor(code: string, message: string, detail?: unknown, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceApplicationError";
    this.code = code;
    this.detail = detail;
  }
}

export class WorkspaceResultUnknownError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceResultUnknownError";
  }
}

export interface StableIdentityOptions<Identity, Result> {
  readonly identity: Identity;
  readonly maxAttempts?: number;
  readonly operation: (identity: Identity) => Promise<Result>;
  readonly publicIdentity?: unknown;
  readonly signal?: AbortSignal;
}

export async function executeWithStableIdentity<Identity, Result>(
  options: StableIdentityOptions<Identity, Result>,
): Promise<Result> {
  const maxAttempts = options.maxAttempts ?? 3;
  let lastUnknown: Error | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      if (lastUnknown !== undefined) break;
      options.signal.throwIfAborted();
    }
    try {
      return await options.operation(options.identity);
    } catch (error) {
      if (!isWorkspaceResultUnknown(error)) throw error;
      lastUnknown = error;
    }
  }
  throw new WorkspaceApplicationError(
    "workspace-result-unknown",
    "The Workspace operation may have completed, but its result could not be confirmed.",
    {
      request: options.publicIdentity === undefined ? options.identity : options.publicIdentity,
      cause: lastUnknown?.message,
    },
  );
}

export function isWorkspaceResultUnknown(
  error: unknown,
): error is WorkspaceResultUnknownError | WorkspaceApplicationError {
  return (
    error instanceof WorkspaceResultUnknownError ||
    (error instanceof WorkspaceApplicationError && error.code === "workspace-result-unknown")
  );
}

export function workspaceError(
  code: string,
  message: string,
  detail?: unknown,
): WorkspaceApplicationError {
  return new WorkspaceApplicationError(code, message, detail);
}
