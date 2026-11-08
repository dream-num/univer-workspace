import { whoami } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import type { Handler } from "../context.js";

export const diagnosticsProbe: Handler<"diagnostics.probe"> = async (ctx) => {
  const identity = await whoami(ctx.http());
  const ticket = z
    .object({ ticket: z.string().min(1) })
    .parse(await ctx.http().json("/universer-api/user/session-ticket"));
  const url = new URL("/universer-api/comb/connect", ctx.transportOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("sessionTicket", ticket.ticket);
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);
    const cleanup = () => {
      ctx.signal.removeEventListener("abort", abort);
      socket.close();
    };
    const abort = () => {
      cleanup();
      reject(new Error("Collaboration probe timed out"));
    };
    ctx.signal.addEventListener("abort", abort, { once: true });
    socket.addEventListener(
      "open",
      () => {
        cleanup();
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        cleanup();
        reject(new Error("Collaboration probe failed"));
      },
      { once: true },
    );
  });
  return {
    output: {
      whoami: identity.subject,
      ticket: true,
      websocket: true,
      transport: ctx.transportOrigin,
    },
  };
};
