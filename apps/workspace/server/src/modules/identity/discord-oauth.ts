import { ApplicationError } from "../../middleware/errors.js";
import type { DiscordOAuthProvider } from "./identity.types.js";

export function createDiscordOAuthProvider(config: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly callbackUrl: string;
}): DiscordOAuthProvider {
  return {
    authorizationUrl(input) {
      const url = new URL("https://discord.com/oauth2/authorize");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.callbackUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "identify");
      url.searchParams.set("state", input.state);
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    async exchangeCode(code, codeVerifier) {
      const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
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
            : "Discord did not issue an access token."
        );
      }

      const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { authorization: `Bearer ${tokenBody.access_token}` },
      });
      const user = (await userResponse.json()) as {
        readonly id?: unknown;
        readonly username?: unknown;
        readonly global_name?: unknown;
        readonly avatar?: unknown;
      };
      if (
        !userResponse.ok ||
        typeof user.id !== "string" ||
        typeof user.username !== "string"
      ) {
        throw oauthError("Discord user profile could not be loaded.");
      }
      return {
        subject: user.id,
        username: user.username,
        displayName:
          typeof user.global_name === "string" && user.global_name.trim()
            ? user.global_name.trim()
            : user.username,
        avatarUrl:
          typeof user.avatar === "string"
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
            : null,
      };
    },
  };
}

function oauthError(message: string): ApplicationError {
  return new ApplicationError("DISCORD_OAUTH_FAILED", 502, message);
}
