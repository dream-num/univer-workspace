/** Build-only plugin: capture after the same appReady barrier as Desktop. */
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import "@deepseek-ai/dsh-cmdline";
import "@deepseek-ai/dsh-client-modules";
import { exportDesktopClient } from "./desktop-client-artifact.ts";

export const inject = ["clientModules", "appReady"];
export interface Config {
  directory: string;
}
export const Config: z<Config> = z.object({ directory: z.string().required() });
export function apply(ctx: Context, config: Config): void {
  if (!process.send || !ctx.appReady)
    throw new Error("Desktop client capture requires a build host");
  ctx.effect(() =>
    ctx.appReady!.onReady(() => {
      void exportDesktopClient(ctx.clientModules, config.directory).then(
        () => process.send?.({ type: "workspace-desktop-client-captured" }),
        (error: unknown) => {
          console.error(error);
          process.send?.({ type: "workspace-desktop-client-capture-failed" });
        },
      );
    }),
  );
}
