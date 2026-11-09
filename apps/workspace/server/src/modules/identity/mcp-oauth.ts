import type { BlockList } from "node:net";
import { isCimdClientId, type CimdClientId } from "./client-metadata-document.js";
import type { OAuthClient } from "./oauth-clients.js";
import { MCP_SCOPES, type McpScope, type AccessTokenService, type OAuthClientRecord } from "./access-tokens.js";

/** MCP OAuth is enabled only when the deployment names the MCP resources clients may request. */
export interface McpOAuthConfig {
  /** The Workspace public origin; the RFC 8414 issuer. */
  readonly issuer: string;
  /** Exact `resource` values (RFC 8707) MCP clients may request. */
  readonly resources: readonly string[];
  readonly maxRegisteredClients: number;
  readonly cimdEnabled?: boolean;
  readonly cimdExemptNetworks?: BlockList;
}

export const MAX_REGISTERED_REDIRECT_URIS = 10;
export const MAX_CLIENT_NAME_LENGTH = 100;
const ALLOWED_PRIVATE_USE_SCHEMES: readonly string[] = ["cursor"];
const MAX_REDIRECT_URI_LENGTH = 2000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);
const GRANT_TYPES = ["authorization_code", "refresh_token"] as const;

export function authorizationServerMetadata(config: McpOAuthConfig) {
  return {
    issuer: config.issuer,
    authorization_response_iss_parameter_supported: true,
    ...(config.cimdEnabled === false ? {} : { client_id_metadata_document_supported: true }),
    authorization_endpoint: `${config.issuer}/api/auth/authorize`,
    token_endpoint: `${config.issuer}/api/auth/token`,
    registration_endpoint: `${config.issuer}/api/auth/register`,
    revocation_endpoint: `${config.issuer}/api/auth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: [...GRANT_TYPES],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_SCOPES],
  };
}

export interface ClientRegistration {
  readonly clientName: string | null;
  readonly redirectUris: readonly string[];
  readonly grantTypes: readonly string[];
}

export type RegistrationResult =
  | { readonly ok: true; readonly registration: ClientRegistration }
  | { readonly ok: false; readonly error: "invalid_redirect_uri" | "invalid_client_metadata"; readonly description: string };

/** RFC 7591 metadata for a public native client. Unknown metadata is ignored, not echoed. */
export function parseClientRegistration(body: unknown): RegistrationResult {
  const invalid = (description: string): RegistrationResult => ({ ok: false, error: "invalid_client_metadata", description });
  if (body === null || typeof body !== "object" || Array.isArray(body)) return invalid("The request body must be a JSON object.");
  const metadata = body as Record<string, unknown>;

  const rawUris = metadata.redirect_uris;
  if (!Array.isArray(rawUris) || rawUris.length === 0 || rawUris.length > MAX_REGISTERED_REDIRECT_URIS) {
    return { ok: false, error: "invalid_redirect_uri", description: `redirect_uris must list 1 to ${MAX_REGISTERED_REDIRECT_URIS} URIs.` };
  }
  const redirectUris: string[] = [];
  for (const raw of rawUris) {
    const uri = registrableRedirectUri(raw);
    if (uri === null) {
      return {
        ok: false,
        error: "invalid_redirect_uri",
        description: "Each redirect URI must be a loopback http URL, an https URL, or a reverse-domain or allowlisted private-use scheme (currently cursor), without a fragment or credentials.",
      };
    }
    if (!redirectUris.includes(uri)) redirectUris.push(uri);
  }

  if (metadata.token_endpoint_auth_method !== undefined && metadata.token_endpoint_auth_method !== "none") {
    return invalid('Only public clients are supported; token_endpoint_auth_method must be "none".');
  }
  const grantTypes = metadata.grant_types ?? [...GRANT_TYPES];
  if (
    !Array.isArray(grantTypes) || !grantTypes.includes("authorization_code") ||
    !grantTypes.every((value) => (GRANT_TYPES as readonly unknown[]).includes(value))
  ) {
    return invalid("grant_types must include authorization_code and may add refresh_token.");
  }
  const responseTypes = metadata.response_types;
  if (responseTypes !== undefined && !(Array.isArray(responseTypes) && responseTypes.length === 1 && responseTypes[0] === "code")) {
    return invalid('response_types must be ["code"].');
  }
  if (metadata.scope !== undefined && (typeof metadata.scope !== "string" || parseMcpScopes(metadata.scope) === null)) {
    return invalid(`scope must be a subset of: ${MCP_SCOPES.join(" ")}.`);
  }
  const name = metadata.client_name;
  if (name !== undefined && (typeof name !== "string" || name.trim().length > MAX_CLIENT_NAME_LENGTH)) {
    return invalid(`client_name must be a string of at most ${MAX_CLIENT_NAME_LENGTH} characters.`);
  }
  return {
    ok: true,
    registration: {
      clientName: typeof name === "string" && name.trim() !== "" ? name.trim() : null,
      redirectUris,
      grantTypes: GRANT_TYPES.filter((value) => (grantTypes as readonly unknown[]).includes(value)),
    },
  };
}

/** The normalized form of a redirect URI a dynamically registered client may use, or null. */
export function registrableRedirectUri(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_REDIRECT_URI_LENGTH || raw.includes("#")) return null;
  const url = parseUrl(raw);
  if (url === null || url.username !== "" || url.password !== "") return null;
  if (url.protocol === "https:") return url.toString();
  if (url.protocol === "http:") return isLoopback(url) ? url.toString() : null;
  // RFC 8252 section 7.1 requires a reverse-domain scheme; known MCP clients may need an exception.
  const scheme = url.protocol.slice(0, -1);
  return /^[a-z][a-z0-9+.-]*$/u.test(scheme) && (scheme.includes(".") || ALLOWED_PRIVATE_USE_SCHEMES.includes(scheme)) ? url.toString() : null;
}

/**
 * RFC 8252 section 7.3: a loopback redirect URI matches on scheme, host, path and query with any port.
 * Every other URI matches exactly. Returns the normalized requested URI, or null.
 */
export function matchRegisteredRedirectUri(requested: unknown, registered: readonly string[]): string | null {
  if (typeof requested !== "string") return null;
  const url = parseUrl(requested);
  if (url === null) return null;
  const normalized = url.toString();
  if (registered.includes(normalized)) return normalized;
  if (!isLoopback(url)) return null;
  const portless = withoutPort(url);
  return registered.some((uri) => {
    const candidate = parseUrl(uri);
    return candidate !== null && isLoopback(candidate) && withoutPort(candidate) === portless;
  })
    ? normalized
    : null;
}

/** A space-separated scope string as a canonical subset of the MCP scopes; null when it names anything else. */
export function parseMcpScopes(raw: string): McpScope[] | null {
  const requested = new Set(raw.split(" ").filter((value) => value !== ""));
  const scopes = MCP_SCOPES.filter((scope) => requested.delete(scope));
  return scopes.length === 0 || requested.size > 0 ? null : scopes;
}

/** Parses `MCP_RESOURCE_URLS`: comma-separated absolute http(s) URLs without a fragment, kept verbatim. */
export function parseMcpResourceUrls(raw: string): string[] {
  const resources = [...new Set(raw.split(",").map((value) => value.trim()).filter((value) => value !== ""))];
  if (resources.length === 0) throw new Error("MCP_RESOURCE_URLS must list at least one URL");
  for (const resource of resources) {
    const url = parseUrl(resource);
    if (url === null || (url.protocol !== "https:" && url.protocol !== "http:") || resource.includes("#")) {
      throw new Error("MCP_RESOURCE_URLS must be comma-separated absolute http or https URLs without a fragment");
    }
  }
  return resources;
}

function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

function withoutPort(url: URL): string {
  const copy = new URL(url);
  copy.port = "";
  return copy.toString();
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export type ClientSource =
  | { readonly kind: "static"; readonly client: OAuthClient }
  | { readonly kind: "dcr"; readonly client: OAuthClientRecord }
  | { readonly kind: "cimd"; readonly clientId: CimdClientId };

export function resolveClientSource(
  raw: unknown,
  clients: ReadonlyMap<string, OAuthClient>,
  accessTokens: AccessTokenService,
  config: McpOAuthConfig | null,
): ClientSource | null {
  if (typeof raw !== "string" || raw === "") return null;
  const client = clients.get(raw);
  if (client !== undefined) return { kind: "static", client };
  if (config === null) return null;
  if (config.cimdEnabled !== false && isCimdClientId(raw, [config.issuer, ...config.resources])) return { kind: "cimd", clientId: raw };
  const registered = accessTokens.getClient(raw);
  return registered === null ? null : { kind: "dcr", client: registered };
}
