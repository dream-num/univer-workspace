import { json, Router, urlencoded } from "express";
import { ApplicationError } from "../../middleware/errors.js";
import type { IdentityModule } from "./identity.service.js";
import {
  authorizeRedirectTarget,
  defaultOAuthScope,
  issueOAuthAuthorizationCode,
  requireOAuthAuthorization,
  requireOAuthState,
  validateOAuthClientSecret,
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
    const client = requireRegisteredClient(clients, request.query.client_id);
    const redirectUri = validateRegisteredRedirectUri(
      request.query.redirect_uri,
      client.redirectUris
    );
    const state = requireOAuthState(request.query.state);
    const codeChallenge = requireQueryString(request.query.code_challenge);
    const scope = requireScope(request.query.scope, client);

    const session = options.identity.getSession(request.headers.cookie);
    if (!session.authenticated) {
      const returnTo = `/api/auth/authorize?client_id=${encodeURIComponent(client.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}&scope=${encodeURIComponent(scope)}`;
      response.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    const now = Date.now()
    for (const [code, pending] of options.authorizationStore) {
      if (pending.expiresAt <= now) options.authorizationStore.delete(code)
    }
    const authorization = issueOAuthAuthorizationCode(
      client.clientId,
      state,
      codeChallenge,
      redirectUri,
      scope,
      session.user,
      now
    );
    options.authorizationStore.set(authorization.code, authorization);
    response.redirect(
      authorizeRedirectTarget({ redirectUri, state, scope }, authorization.code)
    );
  });

  router.post("/token", (request, response) => {
    const client = requireRegisteredClient(clients, request.body.client_id);
    validateOAuthClientSecret(request.body.client_secret, client.clientSecret);
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
