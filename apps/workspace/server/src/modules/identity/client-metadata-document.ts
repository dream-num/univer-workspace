import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Agent, request, type RequestOptions } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { logger } from "../../logging/logger.js";
import { MAX_CLIENT_NAME_LENGTH, MAX_REGISTERED_REDIRECT_URIS, registrableRedirectUri } from "./mcp-oauth.js";

export type CimdClientId = string & { readonly __brand: "CimdClientId" };
export interface CimdClient {
  readonly clientId: CimdClientId;
  readonly clientName: string | null;
  readonly host: string;
  readonly redirectUris: readonly string[];
  readonly grantTypes: readonly ("authorization_code" | "refresh_token")[];
  readonly expiresAt: number;
}

const MIN_TTL = 5 * 60_000;
const MAX_TTL = 24 * 60 * 60_000;
const MAX_BODY = 5 * 1024;
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
// BlockList applies IPv4 rules to mapped IPv6 already; blocking ::ffff:0:0/96 also blocks public IPv4.
for (const [address, prefix] of [
  ["::", 96], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(address, prefix, "ipv6");
const protectedNetworks = [
  ["127.0.0.0", 8, "ipv4"], ["169.254.0.0", 16, "ipv4"],
  ["::1", 128, "ipv6"], ["fe80::", 10, "ipv6"],
] as const;
const neverExempt = new BlockList();
for (const [address, prefix, family] of protectedNetworks) neverExempt.addSubnet(address, prefix, family);

export class ClientMetadataDocumentError extends Error {
  constructor(readonly temporary: boolean, message: string) {
    super(message);
    this.name = "ClientMetadataDocumentError";
  }
}

function invalid(message: string): never {
  throw new ClientMetadataDocumentError(false, message);
}

export function isCimdClientId(raw: string, forbidden: readonly string[]): raw is CimdClientId {
  if (raw.length > 2000 || forbidden.includes(raw) || !/^https:\/\/[^/?#]+\//iu.test(raw) || /[\s\\?#]/u.test(raw)) return false;
  // URL removes dot segments, including percent-encoded dots, before exposing pathname.
  const pathStart = raw.indexOf("/", raw.indexOf("://") + 3);
  if (raw.slice(0, pathStart).includes("@")) return false;
  const path = raw.slice(pathStart);
  if (/(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/iu.test(path)) return false;
  if (!URL.canParse(raw)) return false;
  const url = new URL(raw);
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.pathname !== "/";
}

export function parseCimdExemptNetworks(raw = ""): BlockList {
  const exemptions = new BlockList();
  for (const cidr of raw.split(",").map((value) => value.trim()).filter(Boolean)) {
    const [address = "", bits, extra] = cidr.split("/");
    const version = isIP(address);
    const prefix = Number(bits);
    if (!version || bits === undefined || !/^\d+$/u.test(bits) || extra !== undefined || prefix > (version === 4 ? 32 : 128)) {
      throw new Error("MCP_CIMD_EXEMPT_NETWORKS must contain comma-separated IP CIDRs");
    }
    const family = version === 4 ? "ipv4" : "ipv6";
    const network = new BlockList();
    network.addSubnet(address, prefix, family);
    if (neverExempt.check(address, family) || protectedNetworks.some(([ip, , type]) => network.check(ip, type))) {
      throw new Error("MCP_CIMD_EXEMPT_NETWORKS cannot overlap loopback or link-local networks");
    }
    exemptions.addSubnet(address, prefix, family);
  }
  return exemptions;
}

export function assertCimdAddress(address: string, exemptions = new BlockList()): void {
  const version = isIP(address);
  const family = version === 4 ? "ipv4" : "ipv6";
  if (!version || neverExempt.check(address, family) || (blocked.check(address, family) && !exemptions.check(address, family))) {
    invalid("Client metadata address is not a public network address.");
  }
}

export function createCimdLookup(
  exemptions = new BlockList(),
  resolve: (hostname: string) => Promise<LookupAddress[]> = (hostname) => lookup(hostname, { all: true }),
): LookupFunction {
  return (hostname, options, callback) => {
    void resolve(hostname).then((addresses) => {
      if (addresses.length === 0) throw new ClientMetadataDocumentError(true, "Client metadata hostname has no addresses.");
      for (const { address } of addresses) assertCimdAddress(address, exemptions);
      const first = addresses[0]!;
      if (options.all) callback(null, addresses);
      else callback(null, first.address, first.family);
    }).catch((error: unknown) => callback(error instanceof Error ? error : new Error("DNS lookup failed"), []));
  };
}

export interface ClientMetadataResponse {
  readonly body: string;
  readonly cacheControl?: string;
}
export type FetchClientMetadataDocument = (clientId: CimdClientId) => Promise<ClientMetadataResponse>;

export async function fetchClientMetadataDocument(
  clientId: CimdClientId,
  options: { readonly exemptions?: BlockList; readonly lookup?: LookupFunction; readonly request?: (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest } = {},
): Promise<ClientMetadataResponse> {
  const url = new URL(clientId);
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  if (isIP(hostname)) assertCimdAddress(hostname, options.exemptions);
  // Never use the environment-proxy-aware global agent: a CONNECT tunnel bypasses our lookup.
  const agent = new Agent({ lookup: options.lookup ?? createCimdLookup(options.exemptions) });
  try {
    return await new Promise((resolve, reject) => {
      const req = (options.request ?? request)(url, { method: "GET", agent, headers: { accept: "application/json" } }, (response) => {
        if (response.statusCode !== 200) {
          reject(new ClientMetadataDocumentError((response.statusCode ?? 0) >= 500, "Client metadata endpoint did not return HTTP 200."));
          response.destroy();
          req.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size >= MAX_BODY) {
            reject(new ClientMetadataDocumentError(false, "Client metadata document must be smaller than 5 KB."));
            response.destroy();
            req.destroy();
          }
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8"), ...(response.headers["cache-control"] === undefined ? {} : { cacheControl: response.headers["cache-control"] }) }));
      });
      const timer = setTimeout(() => {
        reject(new ClientMetadataDocumentError(true, "Client metadata fetch exceeded 5 seconds."));
        req.destroy();
      }, 5000);
      req.on("error", reject);
      req.on("close", () => clearTimeout(timer));
      req.end();
    });
  } catch (error) {
    if (error instanceof ClientMetadataDocumentError) throw error;
    throw new ClientMetadataDocumentError(true, "Client metadata network request failed.");
  } finally {
    agent.destroy();
  }
}

export function parseClientMetadataDocument(clientId: CimdClientId, response: ClientMetadataResponse, now = Date.now()): CimdClient {
  let value: unknown;
  try { value = JSON.parse(response.body); } catch { invalid("Client metadata must be JSON."); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid("Client metadata must be a JSON object.");
  const doc = value as Record<string, unknown>;
  if (doc.client_id !== clientId) invalid("Client metadata client_id must match the requested URL exactly.");
  for (const field of ["client_secret", "client_secret_expires_at", "jwks", "jwks_uri"]) {
    if (field in doc) invalid(`Client metadata must not contain ${field}.`);
  }
  if (("token_endpoint_auth_method" in doc && doc.token_endpoint_auth_method !== "none") ||
      ("token_endpoint_auth_methods_supported" in doc && (!Array.isArray(doc.token_endpoint_auth_methods_supported) || !doc.token_endpoint_auth_methods_supported.includes("none")))) {
    invalid('Client metadata must support authentication method "none".');
  }
  const grants = "grant_types" in doc ? doc.grant_types : ["authorization_code"];
  const responses = "response_types" in doc ? doc.response_types : ["code"];
  if (!Array.isArray(grants) || !grants.every((value) => typeof value === "string") || !grants.includes("authorization_code") ||
      !Array.isArray(responses) || !responses.every((value) => typeof value === "string") || !responses.includes("code")) {
    invalid("Client metadata must support authorization_code and response type code.");
  }
  if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0 || doc.redirect_uris.length > MAX_REGISTERED_REDIRECT_URIS) invalid("Client metadata must list 1 to 10 redirect URIs.");
  const redirectUris = doc.redirect_uris.map((raw) => registrableRedirectUri(raw) ?? invalid("Client metadata contains an invalid redirect URI."));
  const control = response.cacheControl ?? "";
  const seconds = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?\s*(?:,|$)/iu.exec(control)?.[1];
  const ttl = /(?:^|,)\s*no-(?:store|cache)\b/iu.test(control) || seconds === undefined ? MIN_TTL : Math.max(MIN_TTL, Math.min(MAX_TTL, Number(seconds) * 1000));
  return {
    clientId, host: new URL(clientId).hostname,
    clientName: typeof doc.client_name === "string" && doc.client_name.length <= MAX_CLIENT_NAME_LENGTH && doc.client_name.trim() !== "" ? doc.client_name : null,
    redirectUris,
    grantTypes: (["authorization_code", "refresh_token"] as const).filter((grant) => grants.includes(grant)),
    expiresAt: now + ttl,
  };
}

export function createClientMetadataDocumentResolver(options: {
  readonly fetchDocument?: FetchClientMetadataDocument;
  readonly exemptions?: BlockList;
  readonly now?: () => number;
} = {}) {
  const fetchDocument = options.fetchDocument ?? ((id: CimdClientId) => fetchClientMetadataDocument(id, { ...(options.exemptions === undefined ? {} : { exemptions: options.exemptions }) }));
  const now = options.now ?? Date.now;
  const cache = new Map<CimdClientId, { client: CimdClient; fetchedAt: number }>();
  const pending = new Map<CimdClientId, Promise<CimdClient>>();
  const users = new Map<string, CimdClientId>();

  return async (clientId: CimdClientId, userId: string): Promise<CimdClient> => {
    if (now() - (cache.get(clientId)?.fetchedAt ?? now()) >= MAX_TTL) cache.delete(clientId);
    const entry = cache.get(clientId);
    if (entry !== undefined && entry.client.expiresAt > now()) return entry.client;
    const fallback = (error: ClientMetadataDocumentError): CimdClient => {
      if (error.temporary && entry !== undefined && now() - entry.fetchedAt < MAX_TTL) return entry.client;
      throw error;
    };
    let work = pending.get(clientId);
    if ((users.has(userId) && users.get(userId) !== clientId) || (work === undefined && pending.size >= 32)) {
      return fallback(new ClientMetadataDocumentError(true, "Client metadata fetch capacity is busy. Try again."));
    }
    if (work === undefined) {
      const fetchedAt = now();
      work = Promise.resolve().then(async () => {
        let outcome = "success";
        try {
          const client = parseClientMetadataDocument(clientId, await fetchDocument(clientId), fetchedAt);
          cache.delete(clientId);
          if (cache.size >= 1000) {
            for (const [id, cached] of cache) if (cached.client.expiresAt <= now()) cache.delete(id);
            const oldest = cache.keys().next();
            if (cache.size >= 1000 && !oldest.done) cache.delete(oldest.value);
          }
          cache.set(clientId, { client, fetchedAt });
          return client;
        } catch (error) {
          const failure = error instanceof ClientMetadataDocumentError ? error : new ClientMetadataDocumentError(true, "Client metadata network request failed.");
          outcome = failure.temporary ? "temporarily_unavailable" : "invalid_client";
          if (!failure.temporary) cache.delete(clientId);
          throw failure;
        } finally {
          pending.delete(clientId);
          for (const [user, id] of users) if (id === clientId) users.delete(user);
          logger.info({ event: "oauth.cimd.fetch", client_id: clientId, outcome }, "Client metadata fetch");
        }
      });
      pending.set(clientId, work);
    }
    users.set(userId, clientId);
    try { return await work; }
    catch (error) {
      if (error instanceof ClientMetadataDocumentError) return fallback(error);
      throw error;
    }
  };
}
