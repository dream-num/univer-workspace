import { randomBytes } from "node:crypto";
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
  requireOAuthCodeChallenge,
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
  const consentTokens = new Map<string, { readonly userId: string; readonly request: AuthorizationRequest; readonly expiresAt: number }>();
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
    for (const [token, entry] of consentTokens) if (entry.expiresAt <= Date.now()) consentTokens.delete(token);
    const consentToken = randomBytes(32).toString("base64url");
    consentTokens.set(consentToken, { userId: session.user.id, request: authorizationRequest, expiresAt: Date.now() + 5 * 60_000 });
    const callbackOrigin = new URL(authorizationRequest.redirectUri).origin;
    response.set({
      "cache-control": "no-store",
      "content-security-policy": `default-src 'none'; form-action 'self' ${callbackOrigin}; base-uri 'none'; style-src 'unsafe-inline'`,
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    });
    response.type("html").send(renderConsentPage(authorizationRequest, session.user.displayName, consentToken));
  });

  router.post("/authorize/consent", (request, response) => {
    const session = options.identity.getSession(request.headers.cookie);
    if (!session.authenticated) throw new ApplicationError("UNAUTHENTICATED", 401, "Sign in is required.");
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
    consentTokens.delete(token);
    if (pending === undefined || pending.expiresAt <= Date.now() || pending.userId !== session.user.id) {
      throw new ApplicationError(
        "INVALID_INPUT",
        400,
        "The consent request is invalid, expired, or already used.",
        "consent_token",
      );
    }
    const authorizationRequest = pending.request;
    if (request.body.decision !== "allow") {
      const target = new URL(authorizationRequest.redirectUri);
      target.searchParams.set("error", "access_denied");
      target.searchParams.set("state", authorizationRequest.state);
      response.redirect(303, target.toString());
      return;
    }
    response.redirect(303, issueAuthorization(options, authorizationRequest, session.user));
  });

  router.post("/token", (request, response) => {
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

function renderConsentPage(
  request: AuthorizationRequest,
  displayName: string,
  consentToken: string,
): string {
  const clientId = escapeHtml(request.clientId);
  const user = escapeHtml(displayName);
  const scope = escapeHtml(request.scope);
  const token = escapeHtml(consentToken);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize ${clientId} | Univer Workspace</title><style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#f6f7fb;color-scheme:light}
    *{box-sizing:border-box}body{margin:0;min-width:320px;min-height:100vh;background:radial-gradient(circle at 15% 10%,#e9e7ff 0,transparent 38%),radial-gradient(circle at 90% 90%,#dff5f2 0,transparent 42%),#f6f7fb}
    main{display:grid;min-height:100vh;place-items:center;padding:32px 20px}.card{width:min(440px,100%);padding:32px;border:1px solid #e2e4ea;border-radius:20px;background:#fff;box-shadow:0 18px 50px #252a3d14}.brand{display:flex;align-items:center;gap:12px;margin-bottom:28px}.logo{display:grid;width:42px;height:42px;place-items:center;border-radius:12px;background:linear-gradient(135deg,#7167e8,#5147bd);color:#fff;font-weight:800;letter-spacing:-.04em}.eyebrow{margin:0 0 5px;color:#6b6f7b;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}h1{margin:0;font-size:22px;line-height:1.25;letter-spacing:-.02em}p{margin:0;color:#5c606d;font-size:14px;line-height:1.55}.request{margin:0 0 24px;padding:16px;border-radius:12px;background:#f6f7fb}.request strong{color:#171717;font-size:15px;overflow-wrap:anywhere}.scopes{margin-top:8px;color:#6b6f7b;font-size:13px}.actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}.actions button{min-height:44px;padding:0 16px;border:1px solid #d8dbe4;border-radius:10px;background:#fff;color:#30333d;font:inherit;font-weight:650;cursor:pointer}.actions button:hover{background:#f6f7fb}.actions button[value=allow]{border-color:#5b50d6;background:#5b50d6;color:#fff}.actions button[value=allow]:hover{background:#4e43c7}@media(max-width:480px){main{padding:16px}.card{padding:24px;border:0;box-shadow:none}}
  </style></head><body><main><section class="card" aria-labelledby="consent-title"><div class="brand"><span class="logo" aria-hidden="true">U</span><div><p class="eyebrow">Univer Workspace</p><h1 id="consent-title">Authorize external client</h1></div></div><div class="request"><p><strong>${clientId}</strong> requests access as <strong>${user}</strong>.</p><p class="scopes">Requested scopes: ${scope}</p></div><form method="post" action="/api/auth/authorize/consent"><input type="hidden" name="consent_token" value="${token}"><div class="actions"><button type="submit" name="decision" value="deny">Deny</button><button type="submit" name="decision" value="allow">Allow</button></div></form></section></main></body></html>`;
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
      client.redirectUris,
      client.clientId,
    ),
    state: requireOAuthState(values.state),
    codeChallenge: requireOAuthCodeChallenge(values.code_challenge),
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
      `OAuth client "${clientId}" is not registered for this Workspace deployment.`,
      "client_id",
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
