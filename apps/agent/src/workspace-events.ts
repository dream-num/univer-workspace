import type { Context } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { TypertRegistry } from "@deepseek-ai/dsh-typert-registry";
import type { WorkspaceAuthProvider } from "./workspace-auth-provider.ts";
import { subscribeWorkspaceChanges } from "./workspace-change-feed.ts";
import {
  workspaceEventsDescriptor,
  workspaceEventsPackage,
  type WorkspaceChange,
} from "./workspace-events-contract.ts";

/** Account-scoped feed owner exposed as a logical stream on DSH's existing mux. */
export class WorkspaceEvents extends TypertRemoteService {
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();
  private pending: ReturnType<typeof setTimeout> | undefined;

  constructor(
    ctx: Context,
    private readonly auth: WorkspaceAuthProvider,
  ) {
    super(ctx, "workspaceEvents");
    (ctx.typert as TypertRegistry).register({
      package: workspaceEventsPackage,
      face: "host",
      schemas: [],
      model: { services: [], events: [], objects: [] },
      invocations: [workspaceEventsDescriptor],
    });
    const client = auth.currentClient();
    const stop =
      client === undefined ? () => {} : subscribeWorkspaceChanges(client, () => this.changed());
    ctx.effect(() => () => {
      this.lifetime.abort();
      stop();
      if (this.pending !== undefined) clearTimeout(this.pending);
    });
  }

  private changed(): void {
    if (this.pending !== undefined) return;
    this.pending = setTimeout(() => {
      this.pending = undefined;
      this.revision++;
      for (const listener of this.listeners) listener();
    }, 100);
  }

  async *follow(signal: AbortSignal): AsyncGenerator<WorkspaceChange> {
    const lifetime = AbortSignal.any([signal, this.lifetime.signal]);
    let wake: (() => void) | undefined;
    let dirty = true;
    const notify = () => {
      dirty = true;
      wake?.();
    };
    this.listeners.add(notify);
    lifetime.addEventListener("abort", notify);
    try {
      while (!lifetime.aborted) {
        if (!dirty)
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        if (lifetime.aborted) break;
        dirty = false;
        yield { version: this.auth.connectionVersion(), revision: this.revision };
      }
    } finally {
      this.listeners.delete(notify);
      lifetime.removeEventListener("abort", notify);
    }
  }
}

export const inject = ["workspaceRuntime", "typert", "workspaceAuth"];
export function apply(ctx: Context): void {
  new WorkspaceEvents(ctx, ctx.workspaceAuth as WorkspaceAuthProvider);
}
