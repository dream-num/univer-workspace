/** Authenticated readiness notification for the application-owned desktop launcher. */
import type { Context } from "@deepseek-ai/cordis";
import "@deepseek-ai/dsh-cmdline";
import "@deepseek-ai/dsh-client-connection";
import "@deepseek-ai/dsh-host-webserver";

export const inject = ["connection", "webServer", "appReady"];

export function apply(ctx: Context): void {
  if (process.env.UWA_DESKTOP !== "1" || !process.send) return;
  const ready = ctx.appReady;
  if (!ready) throw new Error("Desktop startup requires the DSH appReady service");
  ctx.effect(() =>
    ready.onReady(() => {
      process.send?.({
        type: "uwh-desktop-ready",
        url: ctx.connection.authenticatedUrl(`http://127.0.0.1:${ctx.webServer.port}`),
      });
    }),
  );
}
