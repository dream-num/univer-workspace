import { z } from "zod";

const origin = z.url().transform((value, ctx) => {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Expected an HTTP(S) origin without credentials, path, query, or fragment",
    });
    return z.NEVER;
  }
  return url.origin;
});
const publicUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ["http:", "https:"].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    url.pathname === "/mcp" &&
    !url.search &&
    !url.hash
  );
}, "MCP_PUBLIC_URL must be an HTTP(S) URL ending in /mcp without credentials, query, or fragment");
const environment = z.object({
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(65535)).default(3000),
  WORKSPACE_ORIGIN: origin,
  WORKSPACE_TRANSPORT_URL: origin.optional(),
  MCP_PUBLIC_URL: publicUrl,
  METRICS_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type GatewayConfig = Readonly<
  z.output<typeof environment> & {
    readonly WORKSPACE_TRANSPORT_URL: string;
    readonly auth: { readonly kind: "dev-session" };
  }
>;

export function parseGatewayConfig(env: NodeJS.ProcessEnv): GatewayConfig {
  if (env["NODE_ENV"] === "production" && env["MCP_DEV_SESSION_PASSTHROUGH"]) {
    throw new Error("NODE_ENV=production forbids non-empty MCP_DEV_SESSION_PASSTHROUGH");
  }
  if (env["MCP_DEV_SESSION_PASSTHROUGH"] !== "1") {
    throw new Error(
      "Stage A requires MCP_DEV_SESSION_PASSTHROUGH=1; no other authentication mode is implemented",
    );
  }
  const config = environment.parse(env);
  return Object.freeze({
    ...config,
    WORKSPACE_TRANSPORT_URL: config.WORKSPACE_TRANSPORT_URL ?? config.WORKSPACE_ORIGIN,
    auth: Object.freeze({ kind: "dev-session" }),
  });
}
