import type { Context } from "@deepseek-ai/cordis";
import type { CredentialProvider } from "@deepseek-ai/dsh-credentials";
import {
  createWorkspaceContentRuntime,
  workspaceError,
  type WorkspaceContentRuntime,
  type WorkspaceContentRuntimeOptions,
} from "@univerjs/univer-workspace-client-core";
import {
  parseWorkspaceGrantRecord,
  WORKSPACE_CREDENTIAL_KEY,
  WorkspaceAuthenticationRequiredError,
} from "./authentication-state.js";
import { UNIVER_LICENSE } from "./license.js";

const WORKSPACE_CONTENT_WORKER_ENTRY = "./worker.js";

interface RuntimeGeneration {
  readonly active: Set<Promise<void>>;
  readonly runtime: WorkspaceContentRuntime;
}

export interface WorkspaceContentRuntimeGenerationOptions {
  readonly createRuntime?: (options: WorkspaceContentRuntimeOptions) => WorkspaceContentRuntime;
  readonly defaultLicense?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly workerEntry?: string | URL;
}

export class WorkspaceContentRuntimeGenerations {
  private closed = false;
  private current: RuntimeGeneration | undefined;
  private replacement: Promise<void> = Promise.resolve();

  public constructor(
    private readonly credentials: CredentialProvider,
    private readonly options: WorkspaceContentRuntimeGenerationOptions = {},
  ) {}

  public async run<Result>(
    signal: AbortSignal,
    body: (runtime: WorkspaceContentRuntime) => Promise<Result>,
  ): Promise<Result> {
    signal.throwIfAborted();
    await this.replacement;
    signal.throwIfAborted();
    if (this.closed) throw workspaceError("COLLABORATION_POOL_CLOSED", "Content runtime is closed");
    const generation = this.current ??= this.createGeneration();
    let resolveCompleted!: () => void;
    const completed = new Promise<void>((resolve) => {
      resolveCompleted = resolve;
    });
    generation.active.add(completed);
    try {
      return await body(generation.runtime);
    } finally {
      resolveCompleted();
      generation.active.delete(completed);
    }
  }

  public retire(): Promise<void> {
    const generation = this.current;
    this.current = undefined;
    if (generation === undefined) return this.replacement;
    this.replacement = this.replacement.then(async () => {
      await Promise.allSettled([...generation.active]);
      await generation.runtime.close();
    });
    return this.replacement;
  }

  public async close(): Promise<void> {
    this.closed = true;
    await this.retire();
  }

  public listen(ctx: Context): () => void {
    return ctx.on("credentials/record-updated", (key) =>
      key === WORKSPACE_CREDENTIAL_KEY ? this.retire() : undefined);
  }

  public resolveLicense(signal?: AbortSignal): string {
    signal?.throwIfAborted();
    const configured = (this.options.env ?? process.env)["UNIVER_LICENSE"];
    const license = configured === undefined || configured.trim().length === 0
      ? (this.options.defaultLicense ?? UNIVER_LICENSE)
      : configured;
    if (license.trim().length === 0) {
      throw workspaceError(
        "workspace-license-required",
        "A Workspace content runtime license is required.",
      );
    }
    return license;
  }

  private createGeneration(): RuntimeGeneration {
    const runtime = (this.options.createRuntime ?? createWorkspaceContentRuntime)({
      resolveCredential: async (target, signal) => {
        signal?.throwIfAborted();
        const record = await this.credentials.readRecord(WORKSPACE_CREDENTIAL_KEY);
        signal?.throwIfAborted();
        const grant = parseWorkspaceGrantRecord(record);
        if (grant?.state !== "authenticated") throw new WorkspaceAuthenticationRequiredError();
        if (grant.origin !== target.origin) {
          throw workspaceError(
            "workspace-origin-mismatch",
            "Refusing a cross-origin Workspace runtime request.",
          );
        }
        return grant.cookie;
      },
      resolveLicense: (signal) => this.resolveLicense(signal),
      workerEntry: this.options.workerEntry
        ?? new URL(WORKSPACE_CONTENT_WORKER_ENTRY, import.meta.url),
    });
    return { active: new Set(), runtime };
  }
}
