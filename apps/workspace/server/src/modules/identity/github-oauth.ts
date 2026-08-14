import { ApplicationError } from "../../middleware/errors.js";
import type { GitHubOAuthProvider } from "./identity.types.js";

export function createGitHubOAuthProvider(config: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly callbackUrl: string;
}): GitHubOAuthProvider {
  return {
    authorizationUrl(input) {
      const url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.callbackUrl);
      url.searchParams.set("scope", "read:user");
      url.searchParams.set("state", input.state);
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    async exchangeCode(code, codeVerifier) {
      const tokenResponse = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: config.callbackUrl,
            code_verifier: codeVerifier,
          }),
        }
      );
      const tokenBody = (await tokenResponse.json()) as {
        readonly access_token?: unknown;
        readonly error_description?: unknown;
      };
      if (!tokenResponse.ok || typeof tokenBody.access_token !== "string") {
        throw oauthError(
          typeof tokenBody.error_description === "string"
            ? tokenBody.error_description
            : "GitHub did not issue an access token."
        );
      }

      const userResponse = await fetch("https://api.github.com/user", {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${tokenBody.access_token}`,
          "user-agent": "univer-workspace-example",
          "x-github-api-version": "2022-11-28",
        },
      });
      const user = (await userResponse.json()) as {
        readonly id?: unknown;
        readonly login?: unknown;
        readonly name?: unknown;
        readonly avatar_url?: unknown;
      };
      if (
        !userResponse.ok ||
        (typeof user.id !== "number" && typeof user.id !== "string") ||
        typeof user.login !== "string"
      ) {
        throw oauthError("GitHub user profile could not be loaded.");
      }
      return {
        subject: String(user.id),
        username: user.login,
        displayName:
          typeof user.name === "string" && user.name.trim()
            ? user.name.trim()
            : user.login,
        avatarUrl:
          typeof user.avatar_url === "string" ? user.avatar_url : null,
      };
    },
  };
}

function oauthError(message: string): ApplicationError {
  return new ApplicationError("GITHUB_OAUTH_FAILED", 502, message);
}
