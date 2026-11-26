import { ClientMetadataDocumentError, ClientMetadataFetchRefusedError, FETCH_TIMEOUT_SECONDS, type CimdClient, type CimdClientId } from "./client-metadata-document.js";
import { randomBytes, randomUUID } from "node:crypto";
import { parse as parseQuery } from "node:querystring";
import { json, Router, urlencoded, type Request, type RequestHandler, type Response } from "express";
import { ApplicationError } from "../../middleware/errors.js";
import { recordLoopEvent } from "../../middleware/loop-metrics.js";
import { ACCESS_TIER_SCOPES, MCP_SCOPES, chosenTier, requestTier, type AccessTokenService, type IssuedGrant, type McpScope, type OAuthClientRecord } from "./access-tokens.js";
import { callbackSource, personPage, renderAuthorizationError, renderConnectPage, renderStaticConsentPage, signedOutPage, type TrialOffer } from "./connect-page.js";
import type { IdentityRepository, SignInCode, StoredAgent } from "./identity.repository.js";
import type { IdentityModule } from "./identity.service.js";
import type { AuthenticatedSession, SessionView, User } from "./identity.types.js";
import { hashSessionSecret } from "./session-token.js";
import { sourceBucket } from "./source-rate-limiter.js";
import {
  CODE_TTL_MS,
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
  type AuthorizationSubject,
  type IssuedAuthorization,
  type OAuthClient,
  type OAuthClientConfig,
} from "./oauth-clients.js";
import {
  matchRegisteredRedirectUri,
  parseClientRegistration,
  parseMcpScopes,
  resolveClientSource,
  resolveMcpResource,
  type ClientSource,
  type McpOAuthConfig,
} from "./mcp-oauth.js";

export const TOKEN_EXCHANGE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
export const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
export const WORKSPACE_SESSION_TOKEN_TYPE = "urn:univer:params:oauth:token-type:workspace-session";
export const DOWNSTREAM_SESSION_TTL_MS = 10 * 60 * 1000;
const REGISTRATION_BODY_LIMIT = "16kb";
const GUEST_AUTHORIZATION_CAPACITY = 10_000;
// An address creates at most 5 agents an hour by default, and one connection opened authorize twice: 20 is twice that.
const GUEST_AUTHORIZATIONS_PER_SOURCE = 20;
const CONSENT_TTL_MS = 5 * 60_000;
const MCP_STATE_PATTERN = /^[\x20-\x7E]{1,1024}$/u;

export function createOAuthAuthorizationRouter(options: {
  readonly identity: IdentityModule;
  readonly accessTokens: AccessTokenService;
  readonly secureCookies: boolean;
  readonly oauthClients: OAuthClientConfig | null;
  readonly codes: SignInCodeStore;
  readonly agents: Pick<IdentityRepository, "findAgents">;
  readonly guestAuthorizationCapacity?: number | undefined;
  readonly mcpOAuth?: McpOAuthConfig | null;
  readonly resolveClientMetadata: ResolveClientMetadata;
}): Router {
  const router = Router();
  const mcp = options.mcpOAuth ?? null;
  router.use(json({ limit: "1mb" }));
  router.use(urlencoded({ extended: false, limit: "1mb" }));
  const clients = new Map<string, OAuthClient>();
  for (const client of options.oauthClients?.clients ?? []) {
    clients.set(client.clientId, client);
  }

  router.get("/authorize", async (request, response) => {
    const session = await options.identity.getSession(request.headers.cookie);
    // A browser that holds only an agent's cookie is signed out here, and the page leaves that cookie alone.
    const person = signedInPerson(session) ? (await options.identity.requireInteractiveSession(request.headers.cookie)).user : null;
    const authorizationRequest = await resolveAuthorizationRequest(request, response, person);
    if (authorizationRequest === null) return;

    if (authorizationRequest.kind === "static") {
      if (person === null) {
        response.redirect(signInPath(authorizePath(authorizationRequest)));
      } else if (authorizationRequest.client.requiresConsent === true) {
        const consentToken = await saveConsent(authorizationRequest, person.id);
        sendPage(response, 200, renderStaticConsentPage(authorizationRequest.clientId, authorizationRequest.scope, person.displayName, consentToken), authorizationRequest.redirectUri);
      } else {
        response.redirect(await issueAuthorization(options, authorizationRequest, { kind: "user", userId: person.id }));
      }
      return;
    }

    const page = person === null
      ? signedOutPage({
          request: authorizationRequest,
          signInUrl: signInPath(authorizePath(authorizationRequest)),
          oauthAuthorization: authorizationQuery(authorizationRequest).toString(),
          denyUrl: authorizationErrorTarget(authorizationRequest.redirectUri, authorizationRequest.state, "access_denied", undefined, authorizationRequest.issuer),
          trial: await trialOffer(request.ip),
        })
      : personPage({
          request: authorizationRequest,
          person,
          owned: await ownedAgents(person.id),
          newAgentRefusal: await agentUnavailable(request.ip),
          consentToken: await saveConsent(authorizationRequest, person.id),
        });
    sendPage(response, 200, renderConnectPage(page), authorizationRequest.redirectUri);
  });

  router.post("/authorize/guest", async (request, response) => {
    response.set("cache-control", "no-store");
    const authorization: unknown = request.body?.oauthAuthorization;
    try {
      if (!options.identity.guestAuthEnabled) {
        throw new ApplicationError("AGENT_CREATE_RATE_LIMITED", 429, "Guest agents are turned off on this Workspace.");
      }
      if (!request.is("application/x-www-form-urlencoded") || typeof authorization !== "string") {
        throw new ApplicationError("INVALID_INPUT", 400, "The trial form must post oauthAuthorization as a form field.", "oauthAuthorization");
      }
      const target = await authorizeGuest(parseQuery(authorization), request.ip);
      if (target === null) {
        throw new ApplicationError("INVALID_INPUT", 400, "This application needs a person signed in to Workspace. Sign in to continue.", "oauthAuthorization");
      }
      response.redirect(303, target);
    } catch (error) {
      if (!(error instanceof ApplicationError)) throw error;
      if (error.retryAfterSeconds !== undefined) response.set("retry-after", String(error.retryAfterSeconds));
      sendPage(response, error.status, renderAuthorizationError({
        title: "Could not start a trial",
        code: error.code,
        message: error.message,
        ...(typeof authorization === "string" ? { back: `/api/auth/authorize?${authorization}` } : {}),
      }));
    }
  });

  router.post("/authorize/consent", async (request, response) => {
    const session = await options.identity.getSession(request.headers.cookie);
    if (!session.authenticated) throw new ApplicationError("UNAUTHENTICATED", 401, "Sign in is required.");
    const { user } = await options.identity.requireInteractiveSession(request.headers.cookie);
    const token = request.body.consent_token;
    if (typeof token !== "string" || token === "") {
      throw new ApplicationError(
        "INVALID_INPUT",
        400,
        "The consent form is missing its consent token.",
        "consent_token",
      );
    }
    const tokenHash = hashSessionSecret(token);
    const invalidConsent = () => new ApplicationError(
      "INVALID_INPUT",
      400,
      "The consent request is invalid, expired, or already used.",
      "consent_token",
    );
    const pending = await options.codes.findSignInCode("consent", tokenHash);
    if (pending === null || pending.expiresAt <= Date.now() || pending.subjectUserId !== session.user.id) {
      await options.codes.deleteSignInCode("consent", tokenHash);
      throw invalidConsent();
    }
    let authorizationRequest = JSON.parse(pending.payload) as ConsentedRequest;
    // Only an explicit deny refuses: the connect page's buttons send no decision.
    const allowed = request.body.decision !== "deny";
    let subject: AuthorizationSubject = { kind: "user", userId: session.user.id };
    // Every refusal below keeps the consent token valid, so the user can go back and choose again.
    if (allowed && authorizationRequest.kind === "mcp") {
      authorizationRequest = { ...authorizationRequest, scopes: ACCESS_TIER_SCOPES[chosenTier(authorizationRequest.scopes, request.body.access)] };
      const connectAs: unknown = request.body.connect_as;
      if (connectAs === "new_agent") {
        const unavailable = await agentUnavailable(request.ip);
        if (unavailable !== null) throw new ApplicationError("AGENT_CREATE_RATE_LIMITED", 429, `${unavailable} Go back and connect as yourself, or as an agent you already own.`, "connect_as");
        subject = { kind: "owned_agent", ownerUserId: user.id, agent: { label: undefined, clientName: authorizationRequest.clientName, originIp: request.ip } };
      } else if (connectAs !== "self") {
        // Any id that is not an agent of this person gets the same answer, so the form reveals no other User.
        if (typeof connectAs !== "string" || !(await ownsAgent(user.id, connectAs))) {
          throw new ApplicationError("INVALID_INPUT", 400, "Connect as a new agent that you own, an agent you already own, or yourself.", "connect_as");
        }
        subject = { kind: "user", userId: connectAs, ownerUserId: user.id };
      }
    }
    // The delete decides which of concurrent submissions, on any replica, uses the token.
    if (!(await options.codes.deleteSignInCode("consent", tokenHash))) throw invalidConsent();
    if (!allowed) {
      response.redirect(303, authorizationErrorTarget(authorizationRequest.redirectUri, authorizationRequest.state, "access_denied", undefined, authorizationRequest.kind === "mcp" ? authorizationRequest.issuer : undefined));
      return;
    }
    response.redirect(303, await issueAuthorization(options, authorizationRequest, subject));
  });

  router.post("/token", async (request, response) => {
    if (request.body?.grant_type === TOKEN_EXCHANGE_GRANT_TYPE) {
      await exchangeToken(request, response);
      return;
    }
    const source = await resolveClientSource(request.body?.client_id, clients, options.accessTokens, mcp);
    if (
      mcp !== null &&
      (request.body?.grant_type === "refresh_token" ||
        source?.kind !== "static")
    ) {
      await mcpToken(request, response, source);
      return;
    }
    if (request.body.grant_type !== "authorization_code") {
      throw new ApplicationError("INVALID_INPUT", 400, "grant_type must be authorization_code.");
    }
    const client = source?.kind === "static" ? source.client : requireRegisteredClient(clients, request.body.client_id);
    validateOAuthClientAuthentication(client, request.body.client_secret);
    const redirectUri = validateRegisteredRedirectUri(
      request.body.redirect_uri,
      client.redirectUris,
      client.clientId,
    );
    const code = requireQueryString(request.body.code);
    const codeVerifier = requireQueryString(request.body.code_verifier);

    const invalidCode = () => new ApplicationError("INVALID_GRANT", 400, "authorization code is invalid.");
    const codeHash = hashSessionSecret(code);
    const stored = await options.codes.findSignInCode("oauth_code", codeHash);
    if (stored === null || stored.state !== "pending") throw invalidCode();
    const authorization = storedAuthorization(stored, code);
    const subject = requireOAuthAuthorization(authorization, {
      code,
      clientId: client.clientId,
      redirectUri,
      codeVerifier,
      now: Date.now(),
    });
    // The delete decides which of concurrent redemptions, on any replica, gets the code.
    if (!(await options.codes.deleteSignInCode("oauth_code", codeHash)) || subject.kind !== "user") throw invalidCode();
    const [user] = await options.identity.findUsers([subject.userId]);
    if (user === undefined) throw invalidCode();

    if (scopeIncludesSession(authorization.scope)) {
      const issued = await options.identity.issueSession(user, "agent");
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
    router.post("/revoke", async (request, response) => {
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
      const source = await resolveClientSource(body.client_id, clients, options.accessTokens, mcp);
      if (source === null || source.kind === "static") {
        oauthError(response, 401, "invalid_client", "client_id is not a registered MCP client.");
        return;
      }
      await options.accessTokens.revokeClientGrant(body.token, source.kind === "cimd" ? source.clientId : source.client.clientId);
      response.status(200).end();
    });
  }

  async function authorizeGuest(values: Record<string, unknown>, sourceIp: string | undefined): Promise<string | null> {
    const clientId = requireQueryString(values.client_id);
    const source = await resolveClientSource(clientId, clients, options.accessTokens, mcp);
    if (source?.kind === "static") return null;
    if (mcp === null || source === null) throw unavailableClient(clientId);
    // Checking a metadata-document client fetches it, so first refuse a source that could not create a guest.
    await options.identity.assertAgentCreationAllowed(sourceIp);
    const client = await resolveAnonymousClient(options.resolveClientMetadata, source, sourceIp);
    const parsed = parseMcpAuthorizationRequest(mcp, client, values);
    return "errorRedirect" in parsed
      ? parsed.errorRedirect
      : await issueAuthorization(
          options,
          { ...parsed, scopes: ACCESS_TIER_SCOPES[requestTier(parsed.scopes)] },
          { kind: "guest", agent: { label: undefined, clientName: client.clientName, originIp: sourceIp } },
        );
  }

  async function saveConsent(authorizationRequest: AuthorizationRequest, userId: string): Promise<string> {
    const now = Date.now();
    const consentToken = randomBytes(32).toString("base64url");
    // A static client carries its secret, so the stored request leaves the client out and keeps only the name an owned agent takes.
    const stored = authorizationRequest.kind === "mcp"
      ? { ...authorizationRequest, client: undefined, clientName: authorizationRequest.client.clientName }
      : { ...authorizationRequest, client: undefined };
    await options.codes.putSignInCode(
      { kind: "consent", codeHash: hashSessionSecret(consentToken), userCodeHash: null, subjectUserId: userId, payload: JSON.stringify(stored), createdAt: now, expiresAt: now + CONSENT_TTL_MS },
      { expiredBefore: now },
    );
    return consentToken;
  }

  async function trialOffer(sourceIp: string | undefined): Promise<TrialOffer> {
    if (!options.identity.guestAuthEnabled) return { kind: "off" };
    const reason = await agentUnavailable(sourceIp);
    return reason === null ? { kind: "offered" } : { kind: "unavailable", reason };
  }

  async function resolveAuthorizationRequest(request: Request, response: Response, person: User | null): Promise<AuthorizationRequest | null> {
    const values = request.query;
    const clientId = requireQueryString(values.client_id);
    const source = await resolveClientSource(clientId, clients, options.accessTokens, mcp);
    if (source?.kind === "static") return parseStaticAuthorizationRequest(source.client, values);
    if (mcp === null || source === null) throw unavailableClient(clientId);
    let client: OAuthClientRecord | CimdClient;
    if (source.kind === "dcr") {
      client = source.client;
    } else {
      // With guests off a signed-out page offers only sign-in, which is not worth an anonymous fetch.
      if (person === null && !options.identity.guestAuthEnabled) {
        response.redirect(signInPath(request.originalUrl));
        return null;
      }
      try {
        client = person === null
          ? await options.resolveClientMetadata(source.clientId, request.ip ?? "", "anonymous")
          : await options.resolveClientMetadata(source.clientId, person.id);
      } catch (error) {
        if (!(error instanceof ClientMetadataDocumentError)) throw error;
        if (person === null && error instanceof ClientMetadataFetchRefusedError) {
          response.redirect(signInPath(request.originalUrl));
          return null;
        }
        sendPage(response, error.temporary ? 503 : 400, renderAuthorizationError({
          title: "This application could not be checked",
          code: error.temporary ? "temporarily_unavailable" : "invalid_client",
          // A signed-out browser learns nothing of the cause, which stays in the fetch log.
          message: person === null ? "The application's metadata document could not be checked." : error.message,
        }));
        return null;
      }
    }
    const parsed = parseMcpAuthorizationRequest(mcp, client, values);
    if ("errorRedirect" in parsed) {
      response.redirect(parsed.errorRedirect);
      return null;
    }
    return parsed;
  }

  async function mcpToken(request: Request, response: Response, source: ClientSource | null): Promise<void> {
    response.set({ "cache-control": "no-store", pragma: "no-cache" });
    const fail = (status: number, error: string, description: string) => oauthError(response, status, error, description);
    const body: Record<string, unknown> = request.body ?? {};
    if (source === null || source.kind === "static") {
      fail(401, "invalid_client", "client_id is not a registered MCP client.");
      return;
    }
    const clientId = source.kind === "cimd" ? source.clientId : source.client.clientId;
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
    if (body.resource !== undefined && (typeof body.resource !== "string" || body.resource === "")) {
      fail(400, "invalid_request", "resource must be a non-empty string.");
      return;
    }
    const resource = typeof body.resource === "string"
      ? (mcp === null ? undefined : resolveMcpResource(mcp, body.resource)) ?? body.resource
      : undefined;
    if (body.grant_type === "refresh_token") {
      if (typeof body.refresh_token !== "string" || body.refresh_token === "") {
        fail(400, "invalid_request", "refresh_token is required.");
        return;
      }
      const refreshed = await options.accessTokens.refreshGrant({ refreshToken: body.refresh_token, clientId, resource });
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
    const codeHash = hashSessionSecret(code);
    const stored = await options.codes.findSignInCode("oauth_code", codeHash);
    const authorization = stored && storedAuthorization(stored, code);
    // A static client's code has no resource and is not this grant's to redeem, so it stays usable.
    const redeemed = authorization?.resource === undefined ? null : await options.codes.redeemSignInCode("oauth_code", codeHash, now);
    if (!authorization || authorization.resource === undefined || redeemed === null) {
      fail(400, "invalid_grant", "The authorization code is invalid or expired.");
      return;
    }
    // RFC 6749 section 4.1.2 asks that a replayed code revoke the grant it produced. The redeemed code stays
    // as the replay record until it would have expired.
    if (redeemed.state === "replayed") {
      if (redeemed.subjectUserId !== null && redeemed.grantId !== null) await options.accessTokens.revokeGrant(redeemed.subjectUserId, redeemed.grantId);
      fail(400, "invalid_grant", "The authorization code was already used; the tokens it produced are revoked.");
      return;
    }
    // One attempt per code: a failed redemption deletes it, so it is neither usable nor a replay record.
    const failRedemption = async (status: number, error: string, description: string) => {
      await options.codes.deleteSignInCode("oauth_code", codeHash);
      fail(status, error, description);
    };
    let subject: AuthorizationSubject;
    try {
      subject = requireOAuthAuthorization(authorization, {
        code,
        clientId,
        redirectUri: URL.canParse(rawRedirectUri) ? new URL(rawRedirectUri).toString() : rawRedirectUri,
        codeVerifier,
        now,
      });
    } catch {
      await failRedemption(400, "invalid_grant", "The authorization code is expired or does not match this client, redirect_uri or code_verifier.");
      return;
    }
    if (resource !== undefined && resource !== authorization.resource) {
      await failRedemption(400, "invalid_grant", "resource does not match the authorization request.");
      return;
    }
    if (subject.kind === "user" && subject.ownerUserId !== undefined && !(await ownsAgent(subject.ownerUserId, subject.userId))) {
      await failRedemption(400, "invalid_grant", "The authorization code is invalid or expired.");
      return;
    }
    let issued: IssuedGrant;
    try {
      const userId = subject.kind === "user" ? subject.userId : (await createAgent(subject)).id;
      issued = await options.accessTokens.issueGrant({ clientId, scopes: authorization.scope.split(" "), resource: authorization.resource, userId });
    } catch (error) {
      if (!(error instanceof ApplicationError && error.code === "AGENT_CREATE_RATE_LIMITED")) {
        await options.codes.deleteSignInCode("oauth_code", codeHash);
        throw error;
      }
      await failRedemption(429, "temporarily_unavailable", error.message);
      return;
    }
    // A replay that arrived before the grant was recorded found none to revoke, so this redemption revokes it.
    if (await options.codes.recordSignInGrant(codeHash, issued.grant.userId, issued.grant.id)) {
      await options.accessTokens.revokeGrant(issued.grant.userId, issued.grant.id);
    }
    sendGrant(response, issued);
  }

  async function createAgent(subject: Exclude<AuthorizationSubject, { readonly kind: "user" }>): Promise<User> {
    if (subject.kind === "owned_agent") return (await options.identity.createAgent({ ...subject.agent, ownerUserId: subject.ownerUserId })).user;
    const { user } = await options.identity.createAgent(subject.agent);
    recordLoopEvent("workspace.guest_agent", { entry: "auth_token" }, { user_id: user.id });
    return user;
  }

  async function ownedAgents(ownerUserId: string): Promise<readonly StoredAgent[]> {
    // A claimed agent never expires, so a stopped one is the only kind to leave out. Ties keep the latest claim first.
    return (await options.agents.findAgents({ ownerUserId }))
      .filter((agent) => !agent.banned)
      .reverse()
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  async function ownsAgent(ownerUserId: string, agentUserId: string): Promise<boolean> {
    const [agent] = await options.agents.findAgents({ userId: agentUserId });
    return agent !== undefined && agent.ownerUserId === ownerUserId && !agent.banned;
  }

  async function agentOwner(agentUserId: string): Promise<User | undefined> {
    const [agent] = await options.agents.findAgents({ userId: agentUserId });
    if (!agent?.ownerUserId) return undefined;
    const [owner] = await options.identity.findUsers([agent.ownerUserId]);
    return owner;
  }

  async function agentUnavailable(sourceIp: string | undefined): Promise<string | null> {
    try {
      await options.identity.assertAgentCreationAllowed(sourceIp);
      return null;
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "AGENT_CREATE_RATE_LIMITED") return error.message;
      throw error;
    }
  }

  async function exchangeToken(request: Request, response: Response): Promise<void> {
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
    const exchanged = await options.accessTokens.exchangeSubjectToken(
      subjectToken, resource, Math.min(DOWNSTREAM_SESSION_TTL_MS, options.identity.sessionTtlMs)
    );
    if (exchanged === null) {
      fail(400, "invalid_grant");
      return;
    }
    const { subject, ttlMs, user, cookieValue } = exchanged;
    const executorAccess = await options.identity.hasExecutorAccess(user.id);
    const owner = user.kind === "agent" && user.claimed ? await agentOwner(user.id) : undefined;
    response.json({
      access_token: cookieValue,
      issued_token_type: WORKSPACE_SESSION_TOKEN_TYPE,
      token_type: "N_A",
      expires_in: Math.floor(ttlMs / 1000),
      scope: subject.scopes.join(" "),
      subject: {
        kind: subject.kind,
        id: subject.id,
        client_id: subject.kind === "oauth" ? subject.clientId : null,
      },
      user,
      ...(owner ? { owner } : {}),
      ...(executorAccess ? { executor_access: true } : {}),
    });
  }

  return router;
}

type ResolveClientMetadata = (clientId: CimdClientId, requester: string, kind?: "anonymous") => Promise<CimdClient>;

/** The client of a request with no session, so a metadata fetch is attributed to its source address. */
async function resolveAnonymousClient(
  resolveClientMetadata: ResolveClientMetadata,
  source: Exclude<ClientSource, { readonly kind: "static" }>,
  sourceIp: string | undefined,
): Promise<OAuthClientRecord | CimdClient> {
  if (source.kind === "dcr") return source.client;
  try {
    // Keyed by source, as a signed-in `/authorize` keys it by User: one metadata fetch in flight per requester.
    return await resolveClientMetadata(source.clientId, sourceIp ?? "", "anonymous");
  } catch (error) {
    if (error instanceof ClientMetadataFetchRefusedError) {
      throw error.reason === "busy"
        ? new ApplicationError("CLIENT_METADATA_BUSY", 503, "This Workspace is busy checking client metadata. Try again in a few seconds.", "oauthAuthorization", FETCH_TIMEOUT_SECONDS)
        : new ApplicationError("AGENT_CREATE_RATE_LIMITED", 429, "Too many client metadata checks came from this address. Try again later.");
    }
    if (!(error instanceof ClientMetadataDocumentError)) throw error;
    // The caller is anonymous, so the cause stays in the fetch log.
    throw new ApplicationError("OAUTH_CLIENT_UNAVAILABLE", error.temporary ? 503 : 400, "The client's metadata document could not be checked.", "oauthAuthorization");
  }
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
    parseRegistration(request, response, async (error?: unknown) => {
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
        await registerClient(options.accessTokens, options.mcpOAuth, request, response);
      } catch (thrown) {
        next(thrown);
      }
    });
  };
}

async function registerClient(accessTokens: AccessTokenService, config: McpOAuthConfig, request: Request, response: Response): Promise<void> {
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
  const record = await accessTokens.registerClient({
    clientName: parsed.registration.clientName,
    redirectUris: parsed.registration.redirectUris,
  }, config.maxRegisteredClients);
  if (!record) {
    oauthError(response, 503, "temporarily_unavailable", "This Workspace cannot register more clients right now.");
    return;
  }
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

/** A request as its consent token stores it. */
type ConsentedRequest = Omit<StaticAuthorizationRequest, "client"> | (Omit<McpAuthorizationRequest, "client"> & { readonly clientName: string | null });

type SignInCodeStore = Pick<IdentityRepository, "putSignInCode" | "findSignInCode" | "deleteSignInCode" | "redeemSignInCode" | "recordSignInGrant">;

/** The authorization an `oauth_code` row holds, for the presented code that hashed to it. */
function storedAuthorization(stored: SignInCode, code: string): IssuedAuthorization {
  return { ...(JSON.parse(stored.payload) as Omit<IssuedAuthorization, "code" | "expiresAt">), code, expiresAt: stored.expiresAt };
}

function signedInPerson(session: SessionView): session is AuthenticatedSession {
  return session.authenticated && session.user.kind === "human";
}

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
  readonly client: OAuthClientRecord | CimdClient;
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
  /** Opaque and optional per RFC 6749; echoed back only when sent. */
  readonly state: string | null;
  readonly codeChallenge: string;
  readonly scopes: readonly McpScope[];
  readonly resource: string;
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
  client: OAuthClientRecord | CimdClient,
  values: Record<string, unknown>,
): McpAuthorizationRequest | { readonly errorRedirect: string; readonly message: string } {
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
    errorRedirect: authorizationErrorTarget(redirectUri, state, error, description, config.issuer),
    message: `${error}: ${description}`,
  });
  if (values.response_type !== "code") return fail("unsupported_response_type", 'response_type must be "code".');
  if (values.code_challenge_method !== "S256") return fail("invalid_request", "PKCE with code_challenge_method S256 is required.");
  const codeChallenge = values.code_challenge;
  if (typeof codeChallenge !== "string" || !PKCE_CHALLENGE_PATTERN.test(codeChallenge)) {
    return fail("invalid_request", "code_challenge must be a base64url S256 PKCE challenge.");
  }
  const resource = typeof values.resource === "string" ? resolveMcpResource(config, values.resource) : undefined;
  if (resource === undefined) {
    return fail("invalid_target", "resource must name this Workspace's MCP server.");
  }
  const scopes = values.scope === undefined || values.scope === ""
    ? [...MCP_SCOPES]
    : typeof values.scope === "string" ? parseMcpScopes(values.scope) : null;
  if (scopes === null) return fail("invalid_scope", `scope must be a subset of: ${MCP_SCOPES.join(" ")}.`);
  return { kind: "mcp", issuer: config.issuer, client, clientId: client.clientId, redirectUri, state, codeChallenge, scopes, resource };
}

function authorizationErrorTarget(redirectUri: string, state: string | null, error: string, description?: string, issuer?: string): string {
  const target = new URL(redirectUri);
  target.searchParams.set("error", error);
  if (issuer !== undefined) target.searchParams.set("iss", issuer);
  if (description !== undefined) target.searchParams.set("error_description", description);
  if (state !== null) target.searchParams.set("state", state);
  return target.toString();
}

/** The query that reproduces a parsed request across the sign-in redirect and the trial form. */
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

function signInPath(returnTo: string): string {
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Every page authorize serves: never cached or framed, and its forms reach only Workspace and the verified callback. */
function sendPage(response: Response, status: number, html: string, redirectUri?: string): void {
  const formAction = redirectUri === undefined ? "'self'" : `'self' ${callbackSource(redirectUri)}`;
  response.status(status).set({
    "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; form-action ${formAction}; base-uri 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'`,
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  }).type("html").send(html);
}

async function issueAuthorization(
  options: {
    readonly codes: SignInCodeStore;
    readonly guestAuthorizationCapacity?: number | undefined;
  },
  authorizationRequest: AuthorizationRequest | ConsentedRequest,
  subject: AuthorizationSubject
): Promise<string> {
  const now = Date.now();
  const scope = authorizationRequest.kind === "static" ? authorizationRequest.scope : authorizationRequest.scopes.join(" ");
  const { code, expiresAt, ...authorization } = issueOAuthAuthorizationCode(
    authorizationRequest.clientId,
    authorizationRequest.codeChallenge,
    authorizationRequest.redirectUri,
    scope,
    subject,
    now,
    authorizationRequest.kind === "mcp" ? authorizationRequest.resource : undefined,
  );
  // Only a guest's code is refused at capacity, and every unredeemed code counts toward it. A source's share counts
  // the guest codes it got within one code lifetime, so no source holds more than that share of the capacity.
  const stored = await options.codes.putSignInCode(
    { kind: "oauth_code", codeHash: hashSessionSecret(code), userCodeHash: null, subjectUserId: subject.kind === "user" ? subject.userId : null, payload: JSON.stringify(authorization), createdAt: now, expiresAt },
    subject.kind === "guest"
      ? {
          expiredBefore: now,
          capacity: options.guestAuthorizationCapacity ?? GUEST_AUTHORIZATION_CAPACITY,
          perSource: {
            event: { id: randomUUID(), action: "guest_authorization", source: sourceBucket(subject.agent.originIp), createdAt: now },
            since: now - CODE_TTL_MS,
            limit: GUEST_AUTHORIZATIONS_PER_SOURCE,
          },
        }
      : { expiredBefore: now },
  );
  if (stored !== "stored") {
    return authorizationErrorTarget(
      authorizationRequest.redirectUri,
      authorizationRequest.state,
      "temporarily_unavailable",
      stored === "source-full"
        ? "Too many sign-ins came from this address. Try again shortly."
        : "This Workspace holds too many unredeemed authorization codes. Try again in a minute.",
      authorizationRequest.kind === "mcp" ? authorizationRequest.issuer : undefined,
    );
  }
  return authorizeRedirectTarget(
    {
      redirectUri: authorizationRequest.redirectUri,
      state: authorizationRequest.state,
      scope,
      ...(authorizationRequest.kind === "mcp" ? { issuer: authorizationRequest.issuer } : {}),
    },
    code
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
