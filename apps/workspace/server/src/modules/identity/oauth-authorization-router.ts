import { json, Router, urlencoded } from "express"
import { ApplicationError } from "../../middleware/errors.js";
import type { IdentityModule } from "./identity.service.js";
import type { User } from "./identity.types.js";
import {
  authorizeRedirectTarget,
  defaultOAuthScope,
  issueOAuthAuthorizationCode,
  requireOAuthAuthorization,
  requireOAuthState,
  scopeIncludesSession,
  validateOAuthClientAuthentication,
  validateRegisteredRedirectUri,
  type IssuedAuthorization,
  type OAuthClient,
  type OAuthClientConfig,
} from "./oauth-clients.js";

export function createOAuthAuthorizationRouter(options: {
  readonly identity: IdentityModule;
  readonly secureCookies: boolean;
  readonly oauthClients: OAuthClientConfig | null;
  readonly authorizationStore: Map<string, IssuedAuthorization>;
}): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));
  router.use(urlencoded({ extended: false, limit: "1mb" }));
  const clients = new Map<string, OAuthClient>();
  for (const client of options.oauthClients?.clients ?? []) {
    clients.set(client.clientId, client);
  }

  router.get("/authorize", (request, response) => {
    const authorizationRequest = parseAuthorizationRequest(
      clients,
      request.query
    );

    const session = options.identity.getSession(request.headers.cookie);
    if (!session.authenticated) {
      response.redirect(
        `/login?returnTo=${encodeURIComponent(
          authorizePath(authorizationRequest)
        )}`
      );
      return;
    }

    if (authorizationRequest.client.requiresConsent === true) {
      response.redirect(`/api/auth/authorize/consent?${new URLSearchParams({
        client_id: authorizationRequest.clientId,
        redirect_uri: authorizationRequest.redirectUri,
        state: authorizationRequest.state,
        code_challenge: authorizationRequest.codeChallenge,
        scope: authorizationRequest.scope,
      }).toString()}`);
      return;
    }

    response.redirect(
      issueAuthorization(options, authorizationRequest, session.user)
    );
  });

  router.get("/authorize/consent", (request, response) => {
    const authorizationRequest = parseAuthorizationRequest(clients, request.query);
    const session = options.identity.getSession(request.headers.cookie);
    if (!session.authenticated) {
      response.redirect(`/login?returnTo=${encodeURIComponent(`/api/auth/authorize/consent?${new URLSearchParams(request.query as Record<string, string>).toString()}`)}`);
      return;
    }
    response.type("html").send(`<!doctype html><title>Authorize ${escapeHtml(authorizationRequest.clientId)}</title><main><h1>Authorize external client</h1><p><strong>${escapeHtml(authorizationRequest.clientId)}</strong> requests access as <strong>${escapeHtml(session.user.displayName)}</strong>.</p><p>Requested scopes: ${escapeHtml(authorizationRequest.scope)}</p><form method="post"><input type="hidden" name="client_id" value="${escapeHtml(authorizationRequest.clientId)}"><input type="hidden" name="redirect_uri" value="${escapeHtml(authorizationRequest.redirectUri)}"><input type="hidden" name="state" value="${escapeHtml(authorizationRequest.state)}"><input type="hidden" name="code_challenge" value="${escapeHtml(authorizationRequest.codeChallenge)}"><input type="hidden" name="scope" value="${escapeHtml(authorizationRequest.scope)}"><button name="decision" value="deny">Deny</button><button name="decision" value="allow">Allow</button></form></main>`);
  });

  router.post("/authorize/consent", (request, response) => {
    const authorizationRequest = parseAuthorizationRequest(clients, request.body);
    const session = options.identity.getSession(request.headers.cookie);
    if (!session.authenticated) throw new ApplicationError("UNAUTHENTICATED", 401, "Sign in is required.");
    if (request.body.decision !== "allow") {
      const target = new URL(authorizationRequest.redirectUri);
      target.searchParams.set("error", "access_denied");
      target.searchParams.set("state", authorizationRequest.state);
      response.redirect(target.toString());
      return;
    }
    response.redirect(issueAuthorization(options, authorizationRequest, session.user));
  });

  router.post("/token", (request, response) => {
    const client = requireRegisteredClient(clients, request.body.client_id);
    validateOAuthClientAuthentication(client, request.body.client_secret);
    const redirectUri = validateRegisteredRedirectUri(
      request.body.redirect_uri,
      client.redirectUris
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
      const issued = options.identity.issueSession(user);
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

  return router;
}

interface AuthorizationRequest {
  readonly client: OAuthClient;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly scope: string;
}

function parseAuthorizationRequest(
  clients: ReadonlyMap<string, OAuthClient>,
  values: Record<string, unknown>
): AuthorizationRequest {
  const client = requireRegisteredClient(clients, values.client_id);
  return {
    client,
    clientId: client.clientId,
    redirectUri: validateRegisteredRedirectUri(
      values.redirect_uri,
      client.redirectUris
    ),
    state: requireOAuthState(values.state),
    codeChallenge: requireQueryString(values.code_challenge),
    scope: requireScope(values.scope, client),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function authorizePath(request: AuthorizationRequest): string {
  const query = new URLSearchParams({
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    state: request.state,
    code_challenge: request.codeChallenge,
    scope: request.scope,
  });
  return `/api/auth/authorize?${query.toString()}`;
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
  const authorization = issueOAuthAuthorizationCode(
    authorizationRequest.clientId,
    authorizationRequest.state,
    authorizationRequest.codeChallenge,
    authorizationRequest.redirectUri,
    authorizationRequest.scope,
    user,
    now
  );
  options.authorizationStore.set(authorization.code, authorization);
  return authorizeRedirectTarget(
    {
      redirectUri: authorizationRequest.redirectUri,
      state: authorizationRequest.state,
      scope: authorizationRequest.scope,
    },
    authorization.code
  );
}

function requireRegisteredClient(
  clients: ReadonlyMap<string, OAuthClient>,
  raw: unknown
): OAuthClient {
  const clientId = requireQueryString(raw);
  const client = clients.get(clientId);
  if (client === undefined) {
    throw new ApplicationError(
      "OAUTH_CLIENT_UNAVAILABLE",
      400,
      "The requested OAuth client is not configured."
    );
  }
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
