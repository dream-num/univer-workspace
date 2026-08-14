import { resolve } from "node:path";

export interface WorkspaceConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseFilename: string;
  readonly collaborationDatabaseFilename: string;
  readonly blobDirectory?: string;
  readonly maxBlobBytes?: number;
  readonly secureCookies: boolean;
  readonly sessionTtlMs: number;
  readonly discordBotApiKey?: string;
  readonly githubOAuth?: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly callbackUrl: string;
  } | null;
  readonly discordOAuth?: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly callbackUrl: string;
  } | null;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): WorkspaceConfig {
  const githubOAuth = githubConfig(environment);
  const discordOAuth = discordConfig(environment);
  const discordBotApiKey = optionalSecret(
    environment.DISCORD_BOT_API_KEY,
    "DISCORD_BOT_API_KEY"
  );
  return {
    host: environment.HOST ?? "127.0.0.1",
    port: integer(environment.PORT, 3020, "PORT"),
    databaseFilename: resolve(
      environment.DATABASE_FILE ?? ".data/univer-workspace.sqlite"
    ),
    collaborationDatabaseFilename: resolve(
      environment.COLLABORATION_DATABASE_FILE ??
        ".data/univer-collaboration.sqlite"
    ),
    blobDirectory: resolve(
      environment.BLOB_DIRECTORY ?? ".data/univer-workspace-blobs"
    ),
    maxBlobBytes: integer(
      environment.MAX_BLOB_BYTES,
      512 * 1024 * 1024,
      "MAX_BLOB_BYTES"
    ),
    secureCookies: boolean(
      environment.SECURE_COOKIES,
      environment.NODE_ENV === "production",
      "SECURE_COOKIES"
    ),
    sessionTtlMs: integer(
      environment.SESSION_TTL_MS,
      7 * 24 * 60 * 60 * 1000,
      "SESSION_TTL_MS"
    ),
    ...(discordBotApiKey ? { discordBotApiKey } : {}),
    githubOAuth,
    discordOAuth,
  };
}

function optionalSecret(
  value: string | undefined,
  name: string
): string | undefined {
  if (value === undefined) return undefined;
  if (value.length < 32) {
    throw new Error(`${name} must contain at least 32 characters`);
  }
  return value;
}

function discordConfig(
  environment: NodeJS.ProcessEnv
): {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly callbackUrl: string;
} | null {
  const values = [
    environment.DISCORD_CLIENT_ID,
    environment.DISCORD_CLIENT_SECRET,
    environment.DISCORD_CALLBACK_URL,
  ];
  if (values.every((value) => value === undefined)) return null;
  if (values.some((value) => !value)) {
    throw new Error(
      "DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and DISCORD_CALLBACK_URL must be configured together"
    );
  }
  return {
    clientId: values[0]!,
    clientSecret: values[1]!,
    callbackUrl: new URL(values[2]!).toString(),
  };
}

function githubConfig(
  environment: NodeJS.ProcessEnv
): {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly callbackUrl: string;
} | null {
  const values = [
    environment.GITHUB_CLIENT_ID,
    environment.GITHUB_CLIENT_SECRET,
    environment.GITHUB_CALLBACK_URL,
  ];
  if (values.every((value) => value === undefined)) return null;
  if (values.some((value) => !value)) {
    throw new Error(
      "GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and GITHUB_CALLBACK_URL must be configured together"
    );
  }
  const callbackUrl = new URL(values[2]!).toString();
  return {
    clientId: values[0]!,
    clientSecret: values[1]!,
    callbackUrl,
  };
}

function boolean(
  value: string | undefined,
  fallback: boolean,
  name: string
): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function integer(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
