import { resolve } from "node:path";

export interface ObserverConfig {
  readonly host: string;
  readonly port: number;
  readonly productDatabaseFilename: string;
  readonly collaborationDatabaseFilename: string;
  readonly observerDatabaseFilename: string;
  readonly blobDirectory: string;
  readonly secureCookies: boolean;
  readonly sessionTtlMs: number;
  readonly queryTimeoutMs: number;
  readonly maxConcurrentQueries: number;
  readonly workspaceVersion?: string;
  readonly setupToken?: string;
  readonly githubOAuth: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly callbackUrl: string;
  } | null;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): ObserverConfig {
  const setupToken = optionalSecret(
    environment.OBSERVER_SETUP_TOKEN,
    "OBSERVER_SETUP_TOKEN"
  );
  const workspaceVersion = optionalText(environment.WORKSPACE_VERSION);
  return {
    host: environment.OBSERVER_HOST ?? "127.0.0.1",
    port: integer(environment.OBSERVER_PORT, 3030, "OBSERVER_PORT"),
    productDatabaseFilename: resolve(
      environment.WORKSPACE_DATABASE_FILE ??
        "../workspace/.data/univer-workspace.sqlite"
    ),
    collaborationDatabaseFilename: resolve(
      environment.COLLABORATION_DATABASE_FILE ??
        "../workspace/.data/univer-collaboration.sqlite"
    ),
    observerDatabaseFilename: resolve(
      environment.OBSERVER_DATABASE_FILE ?? ".data/univer-observer.sqlite"
    ),
    blobDirectory: resolve(
      environment.WORKSPACE_BLOB_DIRECTORY ??
        "../workspace/.data/univer-workspace-blobs"
    ),
    secureCookies: boolean(
      environment.OBSERVER_SECURE_COOKIES,
      environment.NODE_ENV === "production",
      "OBSERVER_SECURE_COOKIES"
    ),
    sessionTtlMs: integer(
      environment.OBSERVER_SESSION_TTL_MS,
      7 * 24 * 60 * 60 * 1_000,
      "OBSERVER_SESSION_TTL_MS"
    ),
    queryTimeoutMs: integer(
      environment.OBSERVER_QUERY_TIMEOUT_MS,
      10_000,
      "OBSERVER_QUERY_TIMEOUT_MS"
    ),
    maxConcurrentQueries: integer(
      environment.OBSERVER_MAX_CONCURRENT_QUERIES,
      2,
      "OBSERVER_MAX_CONCURRENT_QUERIES"
    ),
    ...(workspaceVersion ? { workspaceVersion } : {}),
    ...(setupToken ? { setupToken } : {}),
    githubOAuth: githubConfig(environment),
  };
}

function githubConfig(environment: NodeJS.ProcessEnv): ObserverConfig["githubOAuth"] {
  const values = [
    environment.OBSERVER_GITHUB_CLIENT_ID,
    environment.OBSERVER_GITHUB_CLIENT_SECRET,
    environment.OBSERVER_GITHUB_CALLBACK_URL,
  ];
  if (values.every((value) => value === undefined)) return null;
  if (values.some((value) => !value)) {
    throw new Error(
      "OBSERVER_GITHUB_CLIENT_ID, OBSERVER_GITHUB_CLIENT_SECRET, and OBSERVER_GITHUB_CALLBACK_URL must be configured together"
    );
  }
  return {
    clientId: values[0]!,
    clientSecret: values[1]!,
    callbackUrl: new URL(values[2]!).toString(),
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

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
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
