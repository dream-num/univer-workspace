import { afterEach, describe, expect, it, vi } from "vitest";
import { createGoogleOAuthProvider } from "./google-oauth.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google OAuth", () => {
  it("requests OpenID scopes and PKCE", () => {
    const provider = createGoogleOAuthProvider(config());
    const url = new URL(
      provider.authorizationUrl({
        state: "state-value",
        codeChallenge: "challenge-value",
      })
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(config().callbackUrl);
  });

  it("maps the Google profile to a stable External Identity", async () => {
    vi.stubGlobal(
      "fetch",
      googleFetch({
        sub: "109876543210987654321",
        name: "Alice Example",
        email: "alice.example@gmail.com",
        picture: "https://lh3.googleusercontent.com/alice.png",
      })
    );
    const provider = createGoogleOAuthProvider(config());

    await expect(provider.exchangeCode("code", "verifier")).resolves.toEqual({
      subject: "109876543210987654321",
      username: "alice.example",
      displayName: "Alice Example",
      avatarUrl: "https://lh3.googleusercontent.com/alice.png",
    });
  });

  it("falls back to a subject-derived username when the email local part is unusable", async () => {
    vi.stubGlobal(
      "fetch",
      googleFetch({
        sub: "1234567890",
        email: "+++@gmail.com",
      })
    );
    const provider = createGoogleOAuthProvider(config());

    await expect(provider.exchangeCode("code", "verifier")).resolves.toMatchObject({
      subject: "1234567890",
      username: "google-1234567890",
      displayName: "+++@gmail.com",
      avatarUrl: null,
    });
  });

  it("fails when Google refuses the token exchange", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ error_description: "invalid_grant" }, { status: 400 })
      )
    );
    const provider = createGoogleOAuthProvider(config());

    await expect(provider.exchangeCode("code", "verifier")).rejects.toMatchObject({
      code: "GOOGLE_OAUTH_FAILED",
      status: 502,
      message: "invalid_grant",
    });
  });

  it("fails when the Google profile lacks a subject", async () => {
    vi.stubGlobal("fetch", googleFetch({ email: "alice@example.com" }));
    const provider = createGoogleOAuthProvider(config());

    await expect(provider.exchangeCode("code", "verifier")).rejects.toMatchObject({
      code: "GOOGLE_OAUTH_FAILED",
      status: 502,
    });
  });
});

function config() {
  return {
    clientId: "client-id",
    clientSecret: "client-secret",
    callbackUrl: "https://workspace.example.test/api/auth/google/callback",
  };
}

function googleFetch(profile: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return json({ access_token: "google-token" });
    }
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
      return json(profile);
    }
    throw new Error(`Unexpected Google OAuth request: ${url}`);
  });
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}
