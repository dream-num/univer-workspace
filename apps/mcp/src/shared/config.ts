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
  MCP_RESOURCE_CACHE_DIRECTORY: z.string().min(1).optional(),
  MCP_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  MCP_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type GatewayConfig = Readonly<
  Omit<z.output<typeof environment>, "MCP_OAUTH_CLIENT_SECRET"> & {
    readonly WORKSPACE_TRANSPORT_URL: string;
    readonly auth: {
      readonly exchange: { readonly clientId: string; readonly clientSecret: string } | null;
      readonly devSessionPassthrough: boolean;
    };
  }
>;

export function parseGatewayConfig(env: NodeJS.ProcessEnv): GatewayConfig {
  if (env["NODE_ENV"] === "production" && env["MCP_DEV_SESSION_PASSTHROUGH"]) {
    throw new Error("NODE_ENV=production forbids non-empty MCP_DEV_SESSION_PASSTHROUGH");
  }
  const passthrough = env["MCP_DEV_SESSION_PASSTHROUGH"] ?? "";
  if (passthrough !== "" && passthrough !== "1") {
    throw new Error("MCP_DEV_SESSION_PASSTHROUGH must be 1 when set");
  }
  const config = environment.parse(env);
  const { MCP_OAUTH_CLIENT_SECRET: clientSecret, ...configWithoutSecret } = config;
  const clientId = config.MCP_OAUTH_CLIENT_ID;
  if ((clientId === undefined) !== (clientSecret === undefined)) {
    throw new Error("MCP_OAUTH_CLIENT_ID and MCP_OAUTH_CLIENT_SECRET must be set together");
  }
  if (clientId === undefined && passthrough === "") {
    throw new Error(
      "Configure MCP_OAUTH_CLIENT_ID and MCP_OAUTH_CLIENT_SECRET, or set MCP_DEV_SESSION_PASSTHROUGH=1 for local development",
    );
  }
  return Object.freeze({
    ...configWithoutSecret,
    WORKSPACE_TRANSPORT_URL: config.WORKSPACE_TRANSPORT_URL ?? config.WORKSPACE_ORIGIN,
    auth: Object.freeze({
      exchange:
        clientId === undefined || clientSecret === undefined
          ? null
          : Object.freeze({ clientId, clientSecret }),
      devSessionPassthrough: passthrough === "1",
    }),
  });
}
