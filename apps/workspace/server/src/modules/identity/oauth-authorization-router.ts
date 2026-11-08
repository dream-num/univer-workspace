import { randomBytes } from "node:crypto";
import { json, Router, urlencoded, type Request, type RequestHandler, type Response } from "express";
import { ApplicationError } from "../../middleware/errors.js";
import type { WorkspaceDatabase } from "../../db/database.js";
import { MCP_SCOPES, type AccessTokenService, type IssuedGrant, type McpScope, type OAuthClientRecord, type SubjectToken } from "./access-tokens.js";
import type { IdentityModule } from "./identity.service.js";
import type { IssuedSession, User } from "./identity.types.js";
import {
  authorizeRedirectTarget,
  defaultOAuthScope,
  issueOAuthAuthorizationCode,
  requireOAuthAuthorization,
  requireOAuthState,
  scopeIncludesSession,
  validateOAuthClientAuthentication,
  validateOAuthClientSecret,
  requireOAuthCodeChallenge,
  validateRegisteredRedirectUri,
  PKCE_CHALLENGE_PATTERN,
  type IssuedAuthorization,
  type OAuthClient,
  type OAuthClientConfig,
} from "./oauth-clients.js";
import {
  matchRegisteredRedirectUri,
  parseClientRegistration,
  parseMcpScopes,
  type McpOAuthConfig,
} from "./mcp-oauth.js";

export const TOKEN_EXCHANGE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
export const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
export const WORKSPACE_SESSION_TOKEN_TYPE = "urn:univer:params:oauth:token-type:workspace-session";
export const DOWNSTREAM_SESSION_TTL_MS = 10 * 60 * 1000;
const REGISTRATION_BODY_LIMIT = "16kb";
const MCP_STATE_PATTERN = /^[\x20-\x7E]{1,1024}$/u;
const SCOPE_DESCRIPTIONS: Readonly<Record<McpScope, string>> = {
  read: "View your spaces, files, issues and worktrees",
  write: "Edit inside worktrees, and write issues and labels",
  publish: "Change files and spaces directly, without a worktree",
  "worktree:merge": "Merge and discard worktrees",
};

export function createOAuthAuthorizationRouter(options: {
  readonly identity: IdentityModule;
  readonly accessTokens: AccessTokenService;
  readonly database: WorkspaceDatabase;
  readonly secureCookies: boolean;
  readonly oauthClients: OAuthClientConfig | null;
  readonly authorizationStore: Map<string, IssuedAuthorization>;
  readonly mcpOAuth?: McpOAuthConfig | null;
}): Router {
  const router = Router();
  const mcp = options.mcpOAuth ?? null;
  // Codes already redeemed by MCP clients, kept until they would have expired: RFC 6749 section 4.1.2
  // asks that a replayed code revoke the grant it produced.
  const redeemedCodes = new Map<string, { readonly grantId: string; readonly userId: string; readonly expiresAt: number }>();
  router.use(json({ limit: "1mb" }));
  router.use(urlencoded({ extended: false, limit: "1mb" }));
  const clients = new Map<string, OAuthClient>();
  const consentTokens = new Map<string, { readonly userId: string; readonly request: AuthorizationRequest; readonly expiresAt: number }>();
  for (const client of options.oauthClients?.clients ?? []) {
    clients.set(client.clientId, client);
  }

  router.get("/authorize", (request, response) => {
    const authorizationRequest = resolveAuthorizationRequest(request.query, response);
    if (authorizationRequest === null) return;

    const session = options.identity.getSession(request.headers.cookie);
    if (!session.authenticated) {
      response.redirect(
        `/login?returnTo=${encodeURIComponent(
          authorizePath(authorizationRequest)
        )}`
      );
      return;
    }
    options.identity.requireInteractiveSession(request.headers.cookie);

    if (authorizationRequest.kind === "mcp" || authorizationRequest.client.requiresConsent === true) {
      response.redirect(`/api/auth/authorize/consent?${authorizationQuery(authorizationRequest).toString()}`);
      return;
    }

    response.redirect(
      issueAuthorization(options, authorizationRequest, session.user)
    );
  });

  router.get("/authorize/consent", (request, response) => {
    const authorizationRequest = resolveAuthorizationRequest(request.query, response);
    if (authorizationRequest === null) return;
    const session = options.identity.getSession(request.headers.cookie);
    if (!session.authenticated) {
      response.redirect(`/login?returnTo=${encodeURIComponent(`/api/auth/authorize/consent?${new URLSearchParams(request.query as Record<string, string>).toString()}`)}`);
      return;
    }
    options.identity.requireInteractiveSession(request.headers.cookie);
    for (const [token, entry] of consentTokens) if (entry.expiresAt <= Date.now()) consentTokens.delete(token);
    const consentToken = randomBytes(32).toString("base64url");
    consentTokens.set(consentToken, { userId: session.user.id, request: authorizationRequest, expiresAt: Date.now() + 5 * 60_000 });
    const callback = new URL(authorizationRequest.redirectUri);
    // A private-use scheme has an opaque origin; CSP names it as a scheme source instead.
    const callbackSource = callback.origin === "null" ? callback.protocol : callback.origin;
    response.set({
      "cache-control": "no-store",
      "content-security-policy": `default-src 'none'; form-action 'self' ${callbackSource}; base-uri 'none'; style-src 'unsafe-inline'`,
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    });
    response.type("html").send(
      authorizationRequest.kind === "mcp"
        ? renderMcpConsentPage(authorizationRequest, session.user.displayName, consentToken)
        : renderConsentPage(authorizationRequest, session.user.displayName, consentToken)
    );
  });

  router.post("/authorize/consent", (request, response) => {
    const session = options.identity.getSession(request.headers.cookie);
    if (!session.authenticated) throw new ApplicationError("UNAUTHENTICATED", 401, "Sign in is required.");
    options.identity.requireInteractiveSession(request.headers.cookie);
    const token = request.body.consent_token;
    if (typeof token !== "string" || token === "") {
      throw new ApplicationError(
        "INVALID_INPUT",
        400,
        "The consent form is missing its consent token.",
        "consent_token",
      );
    }
    const pending = consentTokens.get(token);
    if (pending === undefined || pending.expiresAt <= Date.now() || pending.userId !== session.user.id) {
      consentTokens.delete(token);
      throw new ApplicationError(
        "INVALID_INPUT",
        400,
        "The consent request is invalid, expired, or already used.",
        "consent_token",
      );
    }
    let authorizationRequest = pending.request;
    const allowed = request.body.decision === "allow";
    if (allowed && authorizationRequest.kind === "mcp") {
      const checked: unknown[] = [request.body.scope].flat();
      const granted = authorizationRequest.scopes.filter((scope) => checked.includes(scope));
      if (granted.length === 0) {
        // The consent token stays valid so the user can go back and choose.
        throw new ApplicationError("INVALID_INPUT", 400, "Select at least one permission to allow.", "scope");
      }
      authorizationRequest = { ...authorizationRequest, scopes: granted };
    }
    consentTokens.delete(token);
    if (!allowed) {
      response.redirect(303, authorizationErrorTarget(authorizationRequest.redirectUri, authorizationRequest.state, "access_denied"));
      return;
    }
    response.redirect(303, issueAuthorization(options, authorizationRequest, session.user));
  });

  router.post("/token", (request, response) => {
    if (request.body?.grant_type === TOKEN_EXCHANGE_GRANT_TYPE) {
      exchangeToken(request, response);
      return;
    }
    if (
      mcp !== null &&
      (request.body?.grant_type === "refresh_token" ||
        typeof request.body?.client_id !== "string" || !clients.has(request.body.client_id))
    ) {
      mcpToken(request, response);
      return;
    }
    if (request.body.grant_type !== "authorization_code") {
      throw new ApplicationError("INVALID_INPUT", 400, "grant_type must be authorization_code.");
    }
    const client = requireRegisteredClient(clients, request.body.client_id);
    validateOAuthClientAuthentication(client, request.body.client_secret);
    const redirectUri = validateRegisteredRedirectUri(
      request.body.redirect_uri,
      client.redirectUris,
      client.clientId,
    );
    const code = requireQueryString(request.body.code);
    const codeVerifier = requireQueryString(request.body.code_verifier);

    const authorization = options.authorizationStore.get(code);
    if (authorization === undefined) {
      throw new ApplicationError(
        "INVALID_GRANT",
        400,
        "authorization code is invalid."
      );
    }
    const user = requireOAuthAuthorization(authorization, {
      code,
      clientId: client.clientId,
      redirectUri,
      codeVerifier,
      now: Date.now(),
    });
    options.authorizationStore.delete(code);

    if (scopeIncludesSession(authorization.scope)) {
      const issued = options.identity.issueSession(user, "agent");
      response.json({
        access_token: issued.cookieValue,
        token_type: "Bearer",
        expires_in: Math.round(options.identity.sessionTtlMs / 1000),
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        },
      });
      return;
    }

    response.json({
      access_token: "",
      token_type: "Bearer",
      expires_in: 3600,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    });
  });

  if (mcp !== null) {
    router.post("/revoke", (request, response) => {
      response.set({ "cache-control": "no-store", pragma: "no-cache" });
      if (!request.is("application/x-www-form-urlencoded")) {
        oauthError(response, 400, "invalid_request", "The revocation request must be a form body.");
        return;
      }
      const body: Record<string, unknown> = request.body;
      if (typeof body.token !== "string" || body.token === "") {
        oauthError(response, 400, "invalid_request", "token is required.");
        return;
      }
      const client = findRegisteredClient(body.client_id);
      if (client === null) {
        oauthError(response, 401, "invalid_client", "client_id is not a registered MCP client.");
        return;
      }
      options.accessTokens.revokeClientGrant(body.token, client.clientId);
      response.status(200).end();
    });
  }

  /** A dynamically registered client, never a static `OAUTH_CLIENTS_JSON` client, and only while MCP OAuth is enabled. */
  function findRegisteredClient(raw: unknown): OAuthClientRecord | null {
    if (mcp === null || typeof raw !== "string" || raw === "" || clients.has(raw)) return null;
    return options.accessTokens.getClient(raw);
  }

  /** Returns null after redirecting an RFC 6749 section 4.1.2.1 error back to a verified redirect URI. */
  function resolveAuthorizationRequest(values: Record<string, unknown>, response: Response): AuthorizationRequest | null {
    const clientId = requireQueryString(values.client_id);
    const staticClient = clients.get(clientId);
    if (staticClient !== undefined) return parseStaticAuthorizationRequest(staticClient, values);
    const registered = findRegisteredClient(clientId);
    if (mcp === null || registered === null) throw unavailableClient(clientId);
    const parsed = parseMcpAuthorizationRequest(mcp, registered, values);
    if ("errorRedirect" in parsed) {
      response.redirect(parsed.errorRedirect);
      return null;
    }
    return parsed;
  }

  function mcpToken(request: Request, response: Response): void {
    response.set({ "cache-control": "no-store", pragma: "no-cache" });
    const fail = (status: number, error: string, description: string) => oauthError(response, status, error, description);
    const body: Record<string, unknown> = request.body ?? {};
    const client = findRegisteredClient(body.client_id);
    if (client === null) {
      fail(401, "invalid_client", "client_id is not a registered MCP client.");
      return;
    }
    if (!request.is("application/x-www-form-urlencoded")) {
      fail(400, "invalid_request", "The token request must be a form body.");
      return;
    }
    if (typeof body.grant_type !== "string" || body.grant_type === "") {
      fail(400, "invalid_request", "grant_type is required.");
      return;
    }
    if (body.grant_type !== "authorization_code" && body.grant_type !== "refresh_token") {
      fail(400, "unsupported_grant_type", "grant_type must be authorization_code or refresh_token.");
      return;
    }
    if (typeof body.resource !== "string" || body.resource === "") {
      fail(400, "invalid_request", "resource is required.");
      return;
    }
    const resource = body.resource;
    if (body.grant_type === "refresh_token") {
      if (typeof body.refresh_token !== "string" || body.refresh_token === "") {
        fail(400, "invalid_request", "refresh_token is required.");
        return;
      }
      const refreshed = options.accessTokens.refreshGrant({ refreshToken: body.refresh_token, clientId: client.clientId, resource });
      if (!refreshed.ok) {
        fail(400, "invalid_grant", "The refresh token is invalid, expired, revoked, already used, or bound to another client or resource.");
        return;
      }
      sendGrant(response, refreshed);
      return;
    }

    const { code, code_verifier: codeVerifier, redirect_uri: rawRedirectUri } = body;
    if (typeof code !== "string" || code === "" || typeof codeVerifier !== "string" || typeof rawRedirectUri !== "string") {
      fail(400, "invalid_request", "code, code_verifier and redirect_uri are required.");
      return;
    }
    const now = Date.now();
    for (const [redeemed, entry] of redeemedCodes) if (entry.expiresAt <= now) redeemedCodes.delete(redeemed);
    const replayed = redeemedCodes.get(code);
    if (replayed !== undefined) {
      redeemedCodes.delete(code);
      options.accessTokens.revokeGrant(replayed.userId, replayed.grantId);
      fail(400, "invalid_grant", "The authorization code was already used; the tokens it produced are revoked.");
      return;
    }
    const authorization = options.authorizationStore.get(code);
    if (authorization?.resource === undefined) {
      fail(400, "invalid_grant", "The authorization code is invalid or expired.");
      return;
    }
    // One attempt per code: a failed redemption does not leave the code usable.
    options.authorizationStore.delete(code);
    let user: User;
    try {
      user = requireOAuthAuthorization(authorization, {
        code,
        clientId: client.clientId,
        redirectUri: URL.canParse(rawRedirectUri) ? new URL(rawRedirectUri).toString() : rawRedirectUri,
        codeVerifier,
        now,
      });
    } catch {
      fail(400, "invalid_grant", "The authorization code is expired or does not match this client, redirect_uri or code_verifier.");
      return;
    }
    if (resource !== authorization.resource) {
      fail(400, "invalid_grant", "resource does not match the authorization request.");
      return;
    }
    const issued = options.accessTokens.issueGrant({
      userId: user.id,
      clientId: client.clientId,
      scopes: authorization.scope.split(" "),
      resource: authorization.resource,
    });
    redeemedCodes.set(code, { grantId: issued.grant.id, userId: user.id, expiresAt: authorization.expiresAt });
    sendGrant(response, issued);
  }

  function exchangeToken(request: Request, response: Response): void {
    response.set({ "cache-control": "no-store", pragma: "no-cache" });
    const fail = (status: number, error: string) => response.status(status).json({ error });
    if (!request.is("application/x-www-form-urlencoded")) {
      fail(400, "invalid_request");
      return;
    }
    const body: Record<string, unknown> = request.body;
    const client = typeof body.client_id === "string" ? clients.get(body.client_id) : undefined;
    if (client === undefined || client.clientType === "public" || client.clientSecret === undefined) {
      fail(401, "invalid_client");
      return;
    }
    try {
      validateOAuthClientSecret(typeof body.client_secret === "string" ? body.client_secret : undefined, client.clientSecret);
    } catch {
      fail(401, "invalid_client");
      return;
    }
    if (client.tokenExchange !== true) {
      fail(400, "unauthorized_client");
      return;
    }
    if (
      typeof body.subject_token !== "string" || body.subject_token === "" ||
      body.subject_token_type !== ACCESS_TOKEN_TYPE ||
      (body.resource !== undefined && typeof body.resource !== "string")
    ) {
      fail(400, "invalid_request");
      return;
    }
    const subjectToken = body.subject_token;
    const resource = body.resource ?? "";
    // One transaction: a revoke cannot land between the revocation check and the session insert.
    const exchanged = options.database.transaction((): { subject: SubjectToken; user: User; issued: IssuedSession; ttlMs: number } | null => {
      const subject = options.accessTokens.verifySubjectToken(subjectToken, { resource });
      if (subject === null) return null;
      const user = options.identity.findUsers([subject.userId])[0];
      if (user === undefined) return null;
      const ttlMs = Math.min(
        DOWNSTREAM_SESSION_TTL_MS,
        options.identity.sessionTtlMs,
        subject.expiresAt === null ? Infinity : subject.expiresAt - Date.now(),
      );
      if (ttlMs < 1000) return null;
      const issued = options.identity.issueSession(user, "agent", {
        ttlMs,
        issuedFor: { kind: subject.kind, id: subject.id },
      });
      return { subject, user, issued, ttlMs };
    });
    if (exchanged === null) {
      fail(400, "invalid_grant");
      return;
    }
    const { subject, user, issued, ttlMs } = exchanged;
    response.json({
      access_token: issued.cookieValue,
      issued_token_type: WORKSPACE_SESSION_TOKEN_TYPE,
      token_type: "N_A",
      expires_in: Math.floor(ttlMs / 1000),
      scope: subject.scopes.join(" "),
      subject: {
        kind: subject.kind,
        id: subject.id,
        client_id: subject.kind === "oauth" ? subject.clientId : null,
      },
      user: { id: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl },
    });
  }

  return router;
}

/**
 * RFC 7591 registration for public MCP clients. Mounted ahead of the `/api` routers so its own body limit
 * applies: it is an unauthenticated write to the product database.
 */
export function createMcpClientRegistrationHandler(options: {
  readonly accessTokens: AccessTokenService;
  readonly mcpOAuth: McpOAuthConfig;
}): RequestHandler {
  const parseRegistration = json({ limit: REGISTRATION_BODY_LIMIT });
  return (request, response, next) => {
    parseRegistration(request, response, (error?: unknown) => {
      if (error !== undefined) {
        const tooLarge = (error as { status?: unknown }).status === 413;
        oauthError(
          response,
          tooLarge ? 413 : 400,
          "invalid_client_metadata",
          tooLarge ? "The registration request is too large." : "The request body is not valid JSON.",
        );
        return;
      }
      try {
        registerClient(options.accessTokens, options.mcpOAuth, request, response);
      } catch (thrown) {
        next(thrown);
      }
    });
  };
}

function registerClient(accessTokens: AccessTokenService, config: McpOAuthConfig, request: Request, response: Response): void {
  response.set({ "cache-control": "no-store", pragma: "no-cache" });
  if (!request.is("application/json")) {
    oauthError(response, 400, "invalid_client_metadata", "The registration request must be a JSON body.");
    return;
  }
  const parsed = parseClientRegistration(request.body);
  if (!parsed.ok) {
    oauthError(response, 400, parsed.error, parsed.description);
    return;
  }
  if (accessTokens.countClients() >= config.maxRegisteredClients) {
    oauthError(response, 503, "temporarily_unavailable", "This Workspace cannot register more clients right now.");
    return;
  }
  const record = accessTokens.registerClient({
    clientName: parsed.registration.clientName,
    redirectUris: parsed.registration.redirectUris,
  });
  response.status(201).json({
    client_id: record.clientId,
    client_id_issued_at: Math.floor(record.createdAt / 1000),
    ...(record.clientName === null ? {} : { client_name: record.clientName }),
    redirect_uris: record.redirectUris,
    grant_types: parsed.registration.grantTypes,
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: MCP_SCOPES.join(" "),
  });
}

type AuthorizationRequest = StaticAuthorizationRequest | McpAuthorizationRequest;

/** A request from a static `OAUTH_CLIENTS_JSON` client; its rules are unchanged by MCP OAuth. */
interface StaticAuthorizationRequest {
  readonly kind: "static";
  readonly client: OAuthClient;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly scope: string;
}

/** A request from a dynamically registered MCP client, bound to one MCP resource. */
interface McpAuthorizationRequest {
  readonly kind: "mcp";
  readonly client: OAuthClientRecord;
  readonly clientId: string;
  readonly redirectUri: string;
  /** Opaque and optional per RFC 6749; echoed back only when sent. */
  readonly state: string | null;
  readonly codeChallenge: string;
  readonly scopes: readonly McpScope[];
  readonly resource: string;
}

const CONSENT_CSS = `
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#f6f7fb;color-scheme:light}
    *{box-sizing:border-box}body{margin:0;min-width:320px;min-height:100vh;background:radial-gradient(circle at 15% 10%,#e9e7ff 0,transparent 38%),radial-gradient(circle at 90% 90%,#dff5f2 0,transparent 42%),#f6f7fb}
    main{display:grid;min-height:100vh;place-items:center;padding:32px 20px}.card{width:min(440px,100%);padding:32px;border:1px solid #e2e4ea;border-radius:20px;background:#fff;box-shadow:0 18px 50px #252a3d14}.brand{display:flex;align-items:center;gap:12px;margin-bottom:28px}.logo{display:grid;width:42px;height:42px;place-items:center;border-radius:12px;background:linear-gradient(135deg,#7167e8,#5147bd);color:#fff;font-weight:800;letter-spacing:-.04em}.eyebrow{margin:0 0 5px;color:#6b6f7b;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}h1{margin:0;font-size:22px;line-height:1.25;letter-spacing:-.02em}p{margin:0;color:#5c606d;font-size:14px;line-height:1.55}.request{margin:0 0 24px;padding:16px;border-radius:12px;background:#f6f7fb}.request strong{color:#171717;font-size:15px;overflow-wrap:anywhere}.scopes{margin-top:8px;color:#6b6f7b;font-size:13px}.actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}.actions button{min-height:44px;padding:0 16px;border:1px solid #d8dbe4;border-radius:10px;background:#fff;color:#30333d;font:inherit;font-weight:650;cursor:pointer}.actions button:hover{background:#f6f7fb}.actions button[value=allow]{border-color:#5b50d6;background:#5b50d6;color:#fff}.actions button[value=allow]:hover{background:#4e43c7}@media(max-width:480px){main{padding:16px}.card{padding:24px;border:0;box-shadow:none}}`;

function consentDocument(input: {
  readonly title: string;
  readonly heading: string;
  readonly requestHtml: string;
  readonly fieldsHtml: string;
  readonly css?: string;
}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${input.title} | Univer Workspace</title><style>${CONSENT_CSS}${input.css ?? ""}
  </style></head><body><main><section class="card" aria-labelledby="consent-title"><div class="brand"><span class="logo" aria-hidden="true">U</span><div><p class="eyebrow">Univer Workspace</p><h1 id="consent-title">${input.heading}</h1></div></div><div class="request">${input.requestHtml}</div><form method="post" action="/api/auth/authorize/consent">${input.fieldsHtml}<div class="actions"><button type="submit" name="decision" value="deny">Deny</button><button type="submit" name="decision" value="allow">Allow</button></div></form></section></main></body></html>`;
}

function renderConsentPage(
  request: StaticAuthorizationRequest,
  displayName: string,
  consentToken: string,
): string {
  const clientId = escapeHtml(request.clientId);
  const user = escapeHtml(displayName);
  const scope = escapeHtml(request.scope);
  const token = escapeHtml(consentToken);
  return consentDocument({
    title: `Authorize ${clientId}`,
    heading: "Authorize external client",
    requestHtml: `<p><strong>${clientId}</strong> requests access as <strong>${user}</strong>.</p><p class="scopes">Requested scopes: ${scope}</p>`,
    fieldsHtml: `<input type="hidden" name="consent_token" value="${token}">`,
  });
}

function renderMcpConsentPage(
  request: McpAuthorizationRequest,
  displayName: string,
  consentToken: string,
): string {
  const name = escapeHtml(request.client.clientName ?? "An unnamed application");
  const callback = new URL(request.redirectUri);
  const returnsTo = escapeHtml(callback.origin === "null" ? callback.protocol : callback.origin);
  const scopes = request.scopes
    .map((scope) => `<label class="permission"><input type="checkbox" name="scope" value="${escapeHtml(scope)}" checked><span><strong>${escapeHtml(scope)}</strong> ${escapeHtml(SCOPE_DESCRIPTIONS[scope])}</span></label>`)
    .join("");
  return consentDocument({
    title: `Connect ${name}`,
    heading: "Connect an AI assistant",
    requestHtml: `<p><strong>${name}</strong> wants to use Univer Workspace as <strong>${escapeHtml(displayName)}</strong>.</p><p class="scopes">The name is chosen by the application. Server: ${escapeHtml(request.resource)}. Returns to: ${returnsTo}. Client ID: ${escapeHtml(request.clientId)}.</p>`,
    fieldsHtml: `<input type="hidden" name="consent_token" value="${escapeHtml(consentToken)}"><fieldset class="permissions"><legend>Allow it to</legend>${scopes}</fieldset>`,
    css: ".permissions{margin:0 0 24px;padding:0;border:0}.permissions legend{margin-bottom:8px;color:#30333d;font-size:14px;font-weight:650}.permission{display:flex;gap:10px;align-items:flex-start;padding:8px 0;color:#5c606d;font-size:14px;line-height:1.45}.permission input{margin-top:3px}.permission strong{display:block;color:#171717}",
  });
}

function parseStaticAuthorizationRequest(
  client: OAuthClient,
  values: Record<string, unknown>
): StaticAuthorizationRequest {
  return {
    kind: "static",
    client,
    clientId: client.clientId,
    redirectUri: validateRegisteredRedirectUri(
      values.redirect_uri,
      client.redirectUris,
      client.clientId,
    ),
    state: requireOAuthState(values.state),
    codeChallenge: requireOAuthCodeChallenge(values.code_challenge),
    scope: requireScope(values.scope, client),
  };
}

/**
 * An unverified client or redirect URI is reported to the browser; once both are verified, every other
 * error goes back to the client as an RFC 6749 section 4.1.2.1 redirect.
 */
function parseMcpAuthorizationRequest(
  config: McpOAuthConfig,
  client: OAuthClientRecord,
  values: Record<string, unknown>,
): McpAuthorizationRequest | { readonly errorRedirect: string } {
  const redirectUri = matchRegisteredRedirectUri(values.redirect_uri, client.redirectUris);
  if (redirectUri === null) {
    throw new ApplicationError(
      "INVALID_REDIRECT_URI",
      400,
      `redirect_uri is not registered for OAuth client "${client.clientId}".`,
      "redirect_uri",
    );
  }
  const rawState = values.state;
  if (rawState !== undefined && (typeof rawState !== "string" || !MCP_STATE_PATTERN.test(rawState))) {
    throw new ApplicationError("INVALID_INPUT", 400, "state must be 1 to 1024 printable ASCII characters.", "state");
  }
  const state = rawState ?? null;
  const fail = (error: string, description: string) => ({
    errorRedirect: authorizationErrorTarget(redirectUri, state, error, description),
  });
  if (values.response_type !== "code") return fail("unsupported_response_type", 'response_type must be "code".');
  if (values.code_challenge_method !== "S256") return fail("invalid_request", "PKCE with code_challenge_method S256 is required.");
  const codeChallenge = values.code_challenge;
  if (typeof codeChallenge !== "string" || !PKCE_CHALLENGE_PATTERN.test(codeChallenge)) {
    return fail("invalid_request", "code_challenge must be a base64url S256 PKCE challenge.");
  }
  const resource = values.resource;
  if (typeof resource !== "string" || !config.resources.includes(resource)) {
    return fail("invalid_target", "resource must name this Workspace's MCP server.");
  }
  const scopes = values.scope === undefined || values.scope === ""
    ? [...MCP_SCOPES]
    : typeof values.scope === "string" ? parseMcpScopes(values.scope) : null;
  if (scopes === null) return fail("invalid_scope", `scope must be a subset of: ${MCP_SCOPES.join(" ")}.`);
  return { kind: "mcp", client, clientId: client.clientId, redirectUri, state, codeChallenge, scopes, resource };
}

function authorizationErrorTarget(redirectUri: string, state: string | null, error: string, description?: string): string {
  const target = new URL(redirectUri);
  target.searchParams.set("error", error);
  if (description !== undefined) target.searchParams.set("error_description", description);
  if (state !== null) target.searchParams.set("state", state);
  return target.toString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

/** The query that reproduces a parsed request across the login and consent redirects. */
function authorizationQuery(request: AuthorizationRequest): URLSearchParams {
  if (request.kind === "static") {
    return new URLSearchParams({
      client_id: request.clientId,
      redirect_uri: request.redirectUri,
      state: request.state,
      code_challenge: request.codeChallenge,
      scope: request.scope,
    });
  }
  return new URLSearchParams({
    response_type: "code",
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    ...(request.state === null ? {} : { state: request.state }),
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    scope: request.scopes.join(" "),
    resource: request.resource,
  });
}

function authorizePath(request: AuthorizationRequest): string {
  return `/api/auth/authorize?${authorizationQuery(request).toString()}`;
}

function issueAuthorization(
  options: {
    readonly authorizationStore: Map<string, IssuedAuthorization>;
  },
  authorizationRequest: AuthorizationRequest,
  user: User
): string {
  const now = Date.now();
  for (const [code, pending] of options.authorizationStore) {
    if (pending.expiresAt <= now) options.authorizationStore.delete(code);
  }
  const scope = authorizationRequest.kind === "static" ? authorizationRequest.scope : authorizationRequest.scopes.join(" ");
  const authorization = issueOAuthAuthorizationCode(
    authorizationRequest.clientId,
    authorizationRequest.codeChallenge,
    authorizationRequest.redirectUri,
    scope,
    user,
    now,
    authorizationRequest.kind === "mcp" ? authorizationRequest.resource : undefined,
  );
  options.authorizationStore.set(authorization.code, authorization);
  return authorizeRedirectTarget(
    {
      redirectUri: authorizationRequest.redirectUri,
      state: authorizationRequest.state,
      scope,
    },
    authorization.code
  );
}

function sendGrant(response: Response, issued: IssuedGrant): void {
  response.json({
    access_token: issued.accessToken,
    token_type: "Bearer",
    expires_in: issued.expiresIn,
    refresh_token: issued.refreshToken,
    scope: issued.grant.scopes.join(" "),
  });
}

function oauthError(response: Response, status: number, error: string, description: string): void {
  response.status(status).json({ error, error_description: description });
}

function unavailableClient(clientId: string): ApplicationError {
  return new ApplicationError(
    "OAUTH_CLIENT_UNAVAILABLE",
    400,
    `OAuth client "${clientId}" is not registered for this Workspace deployment.`,
    "client_id",
  );
}

function requireRegisteredClient(
  clients: ReadonlyMap<string, OAuthClient>,
  raw: unknown
): OAuthClient {
  const clientId = requireQueryString(raw);
  const client = clients.get(clientId);
  if (client === undefined) throw unavailableClient(clientId);
  return client;
}

function requireScope(raw: unknown, client: OAuthClient): string {
  const requested = typeof raw === "string" && raw !== "" ? raw : defaultOAuthScope();
  const requestedScopes = requested.split(" ").filter((value) => value !== "");
  if (requestedScopes.length === 0) {
    throw new ApplicationError("INVALID_INPUT", 400, "scope must not be empty.");
  }
  for (const value of requestedScopes) {
    if (!client.scopes.includes(value)) {
      throw new ApplicationError(
        "INVALID_INPUT",
        400,
        `scope "${value}" is not permitted for this client.`
      );
    }
  }
  return requested;
}

function requireQueryString(value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw new ApplicationError("INVALID_INPUT", 400, "A required parameter is missing.");
  }
  return value;
}
