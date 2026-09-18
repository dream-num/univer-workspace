import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubOAuthProvider } from "./github-oauth.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub OAuth", () => {
  it("requests organization access only when an allowlist is configured", () => {
    const unrestricted = createGitHubOAuthProvider(config());
    const restricted = createGitHubOAuthProvider({
      ...config(),
      allowedOrganizations: ["dream-num"],
    });

    expect(scope(unrestricted.authorizationUrl(oauthInput()))).toBe("read:user");
    expect(scope(restricted.authorizationUrl(oauthInput()))).toBe("read:user read:org");
  });

  it("accepts an active member of any allowed organization", async () => {
    const fetch = githubFetch((url) =>
      url.endsWith("/dream-num") ? json({ state: "active" }) : json({}, { status: 404 }),
    );
    vi.stubGlobal("fetch", fetch);
    const provider = createGitHubOAuthProvider({
      ...config(),
      allowedOrganizations: ["other-org", "dream-num"],
    });

    await expect(provider.exchangeCode("code", "verifier")).resolves.toMatchObject({
      subject: "101",
      username: "octocat",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/user/memberships/orgs/dream-num",
      expect.any(Object),
    );
  });

  it("rejects users without an active allowed membership", async () => {
    vi.stubGlobal(
      "fetch",
      githubFetch(() => json({}, { status: 404 })),
    );
    const provider = createGitHubOAuthProvider({
      ...config(),
      allowedOrganizations: ["dream-num"],
    });

    await expect(provider.exchangeCode("code", "verifier")).rejects.toMatchObject({
      code: "GITHUB_OAUTH_FAILED",
      status: 403,
    });
  });

  it("fails closed when GitHub cannot verify membership", async () => {
    vi.stubGlobal(
      "fetch",
      githubFetch(() => json({}, { status: 503 })),
    );
    const provider = createGitHubOAuthProvider({
      ...config(),
      allowedOrganizations: ["dream-num"],
    });

    await expect(provider.exchangeCode("code", "verifier")).rejects.toMatchObject({
      code: "GITHUB_OAUTH_FAILED",
      status: 502,
    });
  });
});

function config() {
  return {
    clientId: "client-id",
    clientSecret: "client-secret",
    callbackUrl: "https://workspace.example.test/api/auth/github/callback",
  };
}

function oauthInput() {
  return { state: "state", codeChallenge: "challenge" };
}

function scope(url: string): string | null {
  return new URL(url).searchParams.get("scope");
}

function githubFetch(membership: (url: string) => Response): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://github.com/login/oauth/access_token") {
      return json({ access_token: "github-token" });
    }
    if (url === "https://api.github.com/user") {
      return json({
        id: 101,
        login: "octocat",
        name: "The Octocat",
        avatar_url: "https://avatars.example.test/octocat.png",
      });
    }
    return membership(url);
  });
}

function json(value: unknown, init: { readonly status?: number } = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}
