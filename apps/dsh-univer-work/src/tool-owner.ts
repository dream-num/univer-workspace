import type { ToolRunContext } from "@deepseek-ai/dsh-tools";

export interface WorkspaceOwnedExecution {
  readonly callerSignal: AbortSignal;
  readonly ownerSignal: AbortSignal;
  readonly signal: AbortSignal;
}

export class WorkspaceToolOwner {
  private accepting = true;
  private readonly activeBodies = new Set<Promise<void>>();
  private readonly controller = new AbortController();

  public async run<Result>(
    exec: Pick<ToolRunContext, "signal">,
    body: (owned: WorkspaceOwnedExecution) => Promise<Result>,
  ): Promise<Result> {
    if (!this.accepting) throw new WorkspaceOwnerNotAcceptingError();
    let resolveCompleted!: () => void;
    const completed = new Promise<void>((resolve) => {
      resolveCompleted = resolve;
    });
    this.activeBodies.add(completed);
    const sources = [exec.signal, this.controller.signal];
    try {
      return await body({
        callerSignal: exec.signal,
        ownerSignal: this.controller.signal,
        signal: AbortSignal.any(sources),
      });
    } finally {
      resolveCompleted();
      this.activeBodies.delete(completed);
    }
  }

  public stopAccepting(): void {
    this.accepting = false;
  }

  public abort(): void {
    this.controller.abort(new Error("dsh-univer-work owner disposed"));
  }

  public async drain(): Promise<void> {
    await Promise.allSettled([...this.activeBodies]);
  }
}

export class WorkspaceOwnerNotAcceptingError extends Error {
  public constructor() {
    super("The dsh-univer-work owner is disposing.");
    this.name = "WorkspaceOwnerNotAcceptingError";
  }
}
