import { resolve } from "node:path";
import type { EmailConfig } from "./integrations/email/index.js";
import type { OAuthClientConfig } from "./modules/identity/oauth-clients.js";
import { parseMcpResourceUrls, type McpOAuthConfig } from "./modules/identity/mcp-oauth.js";
import {
  resolveUniverLicense,
  type UniverLicenseCredentials,
} from "./integrations/univer/univer-license.js";

export interface WorkspaceConfig {
  readonly host: string;
  readonly port: number;
  readonly metricsToken?: string;
  readonly databaseFilename: string;
  readonly collaborationDatabaseFilename: string;
  readonly blobDirectory?: string;
  readonly maxBlobBytes?: number;
  readonly secureCookies: boolean;
  readonly sessionTtlMs: number;
  readonly passwordAuthEnabled: boolean;
  /** Configured Email sign-in delivery; null disables Email sign-in. */
  readonly emailAuth: EmailConfig | null;
  readonly trialDeployment?: boolean;
  readonly discordBotApiKey?: string;
  readonly githubOAuth?: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly callbackUrl: string;
    readonly allowedOrganizations: readonly string[];
  } | null;
  readonly googleOAuth?: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly callbackUrl: string;
  } | null;
  readonly discordOAuth?: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly callbackUrl: string;
  } | null;
  readonly oauthClients: OAuthClientConfig | null;
  /** MCP OAuth for dynamically registered clients; null (the default) disables it. */
  readonly mcpOAuth?: McpOAuthConfig | null;
  /** Defaults to the bundled development license. */
  readonly univerLicense?: UniverLicenseCredentials;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): WorkspaceConfig {
  const githubOAuth = githubConfig(environment);
  const googleOAuth = googleConfig(environment);
  const discordOAuth = discordConfig(environment);
  const passwordAuthEnabled = boolean(
    environment.PASSWORD_AUTH_ENABLED,
    true,
    "PASSWORD_AUTH_ENABLED"
  );
  const emailAuth = emailConfig(environment);
  if (
    !passwordAuthEnabled &&
    !emailAuth &&
    !githubOAuth &&
    !googleOAuth &&
    !discordOAuth
  ) {
    throw new Error(
      "PASSWORD_AUTH_ENABLED=false requires Email, GitHub, Google, or Discord sign-in so the deployment still has a browser sign-in method"
    );
  }
  const oauthClientsConfig = oauthClientConfig(environment);
  const discordBotApiKey = optionalSecret(
    environment.DISCORD_BOT_API_KEY,
    "DISCORD_BOT_API_KEY"
  );
  const metricsToken = optionalSecret(environment.METRICS_TOKEN, "METRICS_TOKEN");
  if (metricsToken && !/^[a-zA-Z0-9._~+/-]+=*$/.test(metricsToken)) {
    throw new Error("METRICS_TOKEN must be a valid Bearer token without whitespace");
  }
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
    passwordAuthEnabled,
    emailAuth,
    trialDeployment: boolean(
      environment.TRIAL_DEPLOYMENT,
      false,
      "TRIAL_DEPLOYMENT"
    ),
    ...(discordBotApiKey ? { discordBotApiKey } : {}),
    ...(metricsToken ? { metricsToken } : {}),
    githubOAuth,
    googleOAuth,
    discordOAuth,
    oauthClients: oauthClientsConfig,
    mcpOAuth: mcpOAuthConfig(environment),
    univerLicense: resolveUniverLicense(environment),
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

function oauthClientConfig(
  environment: NodeJS.ProcessEnv
): {
  readonly clients: readonly {
    readonly clientId: string;
    readonly clientType?: "confidential" | "public";
    readonly clientSecret?: string;
    readonly requiresConsent?: boolean;
    readonly tokenExchange?: boolean;
    readonly redirectUris: readonly string[];
    readonly scopes: readonly string[];
  }[];
} | null {
  const raw = environment.OAUTH_CLIENTS_JSON;
  if (raw === undefined || raw === "") return null;
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || !Array.isArray((parsed as { clients?: unknown }).clients)) {
    throw new Error("OAUTH_CLIENTS_JSON must be an object with a clients array");
  }
  const clients = (parsed as { readonly clients: readonly unknown[] }).clients;
  return {
    clients: clients.map((value) => {
      const rawClient = value as Record<string, unknown>;
      const clientId = requireString(rawClient.clientId, "clientId");
      const clientType = rawClient.clientType === "public" ? "public" : "confidential";
      const clientSecret = clientType === "confidential"
        ? requireString(rawClient.clientSecret, "clientSecret")
        : undefined;
      const tokenExchange = rawClient.tokenExchange === true;
      if (tokenExchange && clientType !== "confidential") {
        throw new Error("OAUTH_CLIENTS_JSON tokenExchange requires a confidential client");
      }
      const redirectUris = convertStringArray(rawClient.redirectUris, "redirectUris");
      if (redirectUris.length === 0) {
        throw new Error("OAUTH_CLIENTS_JSON client redirectUris must be a non-empty array");
      }
      const scopes = convertStringArray(rawClient.scopes, "scopes");
      if (scopes.length === 0) {
        throw new Error("OAUTH_CLIENTS_JSON client scopes must be a non-empty array");
      }
      return {
        clientId,
        clientType,
        requiresConsent: rawClient.requiresConsent === true,
        ...(tokenExchange ? { tokenExchange } : {}),
        ...(clientSecret === undefined ? {} : { clientSecret }),
        redirectUris,
        scopes,
      };
    }),
  };
}

function mcpOAuthConfig(environment: NodeJS.ProcessEnv): McpOAuthConfig | null {
  const raw = environment.MCP_RESOURCE_URLS;
  if (raw === undefined || raw.trim() === "") return null;
  const resources = parseMcpResourceUrls(raw);
  const publicOrigin = environment.PUBLIC_ORIGIN;
  if (publicOrigin === undefined || publicOrigin === "") {
    throw new Error("MCP_RESOURCE_URLS requires PUBLIC_ORIGIN, the Workspace origin MCP clients reach");
  }
  const url = URL.canParse(publicOrigin) ? new URL(publicOrigin) : null;
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== publicOrigin.replace(/\/$/u, "")) {
    throw new Error("PUBLIC_ORIGIN must be an http or https origin without a path, for example https://space.example.com");
  }
  const issuer = url.origin;
  return {
    issuer,
    resources,
    maxRegisteredClients: integer(environment.MCP_MAX_REGISTERED_CLIENTS, 10_000, "MCP_MAX_REGISTERED_CLIENTS"),
  };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`OAUTH_CLIENTS_JSON ${name} must be a non-empty string`);
  }
  return value;
}

function convertStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) return [];
  for (const item of value) requireString(item, name);
  return value.map((item) => item as string);
}

function googleConfig(
  environment: NodeJS.ProcessEnv
): {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly callbackUrl: string;
} | null {
  const values = [
    environment.GOOGLE_CLIENT_ID,
    environment.GOOGLE_CLIENT_SECRET,
    environment.GOOGLE_CALLBACK_URL,
  ];
  if (values.every((value) => value === undefined)) return null;
  if (values.some((value) => !value)) {
    throw new Error(
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL must be configured together"
    );
  }
  return {
    clientId: values[0]!,
    clientSecret: values[1]!,
    callbackUrl: new URL(values[2]!).toString(),
  };
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
  readonly allowedOrganizations: readonly string[];
} | null {
  const allowedOrganizations = githubAllowedOrganizations(
    environment.GITHUB_ALLOWED_ORGANIZATIONS
  );
  const values = [
    environment.GITHUB_CLIENT_ID,
    environment.GITHUB_CLIENT_SECRET,
    environment.GITHUB_CALLBACK_URL,
  ];
  if (
    values.every((value) => value === undefined) &&
    allowedOrganizations.length === 0
  ) {
    return null;
  }
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
    allowedOrganizations,
  };
}

function githubAllowedOrganizations(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  const organizations = value
    .split(",")
    .map((organization) => organization.trim());
  if (organizations.some((organization) => !isGitHubLogin(organization))) {
    throw new Error(
      "GITHUB_ALLOWED_ORGANIZATIONS must be a comma-separated list of valid GitHub organization names"
    );
  }
  return [
    ...new Map(
      organizations.map((organization) => [
        organization.toLowerCase(),
        organization,
      ])
    ).values(),
  ];
}

function isGitHubLogin(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value);
}

function emailConfig(environment: NodeJS.ProcessEnv): EmailConfig | null {
  const providerValue = environment.EMAIL_PROVIDER;
  let provider: "smtp" | "console" | undefined;
  if (providerValue !== undefined) {
    if (providerValue !== "smtp" && providerValue !== "console") {
      throw new Error('EMAIL_PROVIDER must be "smtp" or "console"');
    }
    provider = providerValue;
  }
  const smtpHost = environment.EMAIL_SMTP_HOST?.trim() || undefined;
  const hasSmtpSettings =
    smtpHost !== undefined ||
    environment.EMAIL_SMTP_PORT !== undefined ||
    environment.EMAIL_SMTP_SECURE !== undefined ||
    environment.EMAIL_SMTP_USER !== undefined ||
    environment.EMAIL_SMTP_PASSWORD !== undefined;
  const configured =
    provider !== undefined ||
    hasSmtpSettings ||
    environment.EMAIL_FROM !== undefined ||
    environment.EMAIL_FROM_NAME !== undefined;
  const enabled = boolean(
    environment.EMAIL_AUTH_ENABLED,
    configured,
    "EMAIL_AUTH_ENABLED"
  );
  if (!enabled) return null;

  const resolvedProvider =
    provider ?? (hasSmtpSettings ? "smtp" : "console");
  const fromAddress = (environment.EMAIL_FROM ?? "no-reply@localhost").trim();
  if (!/^[^\s<>@]+@[^\s<>@]+$/u.test(fromAddress)) {
    throw new Error("EMAIL_FROM must be an email address");
  }
  const fromName = environment.EMAIL_FROM_NAME?.trim();
  const from =
    fromName === undefined
      ? { address: fromAddress }
      : { address: fromAddress, name: fromName };

  if (resolvedProvider === "console") {
    return { provider: "console", from };
  }
  if (smtpHost === undefined) {
    throw new Error("EMAIL_PROVIDER=smtp requires EMAIL_SMTP_HOST");
  }
  const port = integer(environment.EMAIL_SMTP_PORT, 587, "EMAIL_SMTP_PORT");
  const secure = boolean(
    environment.EMAIL_SMTP_SECURE,
    port === 465,
    "EMAIL_SMTP_SECURE"
  );
  const username = environment.EMAIL_SMTP_USER;
  const password = environment.EMAIL_SMTP_PASSWORD;
  if ((username === undefined) !== (password === undefined)) {
    throw new Error(
      "EMAIL_SMTP_USER and EMAIL_SMTP_PASSWORD must be configured together"
    );
  }
  return {
    provider: "smtp",
    from,
    smtp: {
      host: smtpHost,
      port,
      secure,
      ...(username === undefined
        ? {}
        : { username, password: password ?? "" }),
    },
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
