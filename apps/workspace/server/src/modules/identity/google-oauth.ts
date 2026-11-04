import { ApplicationError } from "../../middleware/errors.js";
import type { GoogleOAuthProvider } from "./identity.types.js";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

export function createGoogleOAuthProvider(config: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly callbackUrl: string;
}): GoogleOAuthProvider {
  return {
    authorizationUrl(input) {
      const url = new URL(AUTHORIZATION_ENDPOINT);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.callbackUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", input.state);
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    async exchangeCode(code, codeVerifier) {
      const tokenResponse = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: config.callbackUrl,
          code_verifier: codeVerifier,
        }),
      });
      const tokenBody = (await tokenResponse.json()) as {
        readonly access_token?: unknown;
        readonly error_description?: unknown;
      };
      if (!tokenResponse.ok || typeof tokenBody.access_token !== "string") {
        throw oauthError(
          typeof tokenBody.error_description === "string"
            ? tokenBody.error_description
            : "Google did not issue an access token."
        );
      }

      const userResponse = await fetch(USERINFO_ENDPOINT, {
        headers: { authorization: `Bearer ${tokenBody.access_token}` },
      });
      const user = (await userResponse.json()) as {
        readonly sub?: unknown;
        readonly name?: unknown;
        readonly email?: unknown;
        readonly picture?: unknown;
      };
      if (!userResponse.ok || typeof user.sub !== "string" || !user.sub) {
        throw oauthError("Google user profile could not be loaded.");
      }
      const email = typeof user.email === "string" ? user.email.trim() : "";
      const username = googleUsername(email, user.sub);
      return {
        subject: user.sub,
        username,
        displayName:
          typeof user.name === "string" && user.name.trim()
            ? user.name.trim()
            : email || username,
        avatarUrl:
          typeof user.picture === "string" ? user.picture : null,
      };
    },
  };
}

/**
 * Google accounts have no provider-specific login handle, so derive the Workspace
 * username from the email local part and fall back to the stable subject. The email
 * itself is not used because `users.username` rejects `@` in profile edits.
 */
function googleUsername(email: string, subject: string): string {
  const localPart = email.split("@")[0] ?? "";
  const sanitized = localPart
    .replaceAll(/[^\p{L}\p{N}._-]/gu, "")
    .slice(0, 64);
  return sanitized || `google-${subject}`;
}

function oauthError(message: string): ApplicationError {
  return new ApplicationError("GOOGLE_OAUTH_FAILED", 502, message);
}
