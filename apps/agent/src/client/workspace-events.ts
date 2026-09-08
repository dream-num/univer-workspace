import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import {
  parseWorkspaceChange,
  workspaceEventsDescriptor,
  workspaceEventsPackage,
  type WorkspaceChange,
} from "../workspace-events-contract.ts";

export const inject = ["remote", "connection"];

/** Subscribe once for the application, independently of its visible conversation. */
export async function apply(ctx: Context): Promise<void> {
  await ctx.remote.$mount({
    package: workspaceEventsPackage,
    descriptors: [workspaceEventsDescriptor],
  });
  const remote = ctx.get("remote.workspaceEvents") as {
    follow(signal: AbortSignal): AsyncIterable<WorkspaceChange>;
  };
  const stream = ctx.remote.$stream({
    name: "Workspace changes",
    open: (signal) => remote.follow(signal),
    ended: () => new Error("Workspace change stream ended"),
  });
  ctx.effect(() => () => stream.dispose());
  void (async () => {
    try {
      for await (const item of stream) {
        const change = parseWorkspaceChange(item.value);
        const version = (globalThis as { __UWH_CONNECTION_VERSION__?: string })
          .__UWH_CONNECTION_VERSION__;
        if (item.signal.aborted || change.version !== version) continue;
        item.accept();
        window.dispatchEvent(new Event("uwh:workspace-changed"));
      }
    } catch (error) {
      if (!stream.signal.aborted) console.error("Workspace change subscription failed", error);
    }
  })();
}
