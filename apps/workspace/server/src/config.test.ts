import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("GitHub organization allowlist configuration", () => {
  it("normalizes and de-duplicates organization names", () => {
    const config = loadConfig({
      GITHUB_CLIENT_ID: "client-id",
      GITHUB_CLIENT_SECRET: "client-secret",
      GITHUB_CALLBACK_URL: "https://workspace.example.test/api/auth/github/callback",
      GITHUB_ALLOWED_ORGANIZATIONS: " dream-num,Univer,univer ",
    });

    expect(config.githubOAuth?.allowedOrganizations).toEqual(["dream-num", "univer"]);
  });

  it("rejects an invalid organization allowlist", () => {
    expect(() =>
      loadConfig({
        GITHUB_CLIENT_ID: "client-id",
        GITHUB_CLIENT_SECRET: "client-secret",
        GITHUB_CALLBACK_URL: "https://workspace.example.test/api/auth/github/callback",
        GITHUB_ALLOWED_ORGANIZATIONS: "dream-num,",
      }),
    ).toThrow("GITHUB_ALLOWED_ORGANIZATIONS");
  });

  it("requires GitHub OAuth credentials when an allowlist is configured", () => {
    expect(() => loadConfig({ GITHUB_ALLOWED_ORGANIZATIONS: "dream-num" })).toThrow(
      "GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and GITHUB_CALLBACK_URL",
    );
  });
});

describe("password authentication configuration", () => {
  it("enables password authentication by default", () => {
    expect(loadConfig({}).passwordAuthEnabled).toBe(true);
  });

  it("disables password authentication when GitHub OAuth remains available", () => {
    const config = loadConfig({
      PASSWORD_AUTH_ENABLED: "false",
      GITHUB_CLIENT_ID: "client-id",
      GITHUB_CLIENT_SECRET: "client-secret",
      GITHUB_CALLBACK_URL: "https://workspace.example.test/api/auth/github/callback",
    });

    expect(config.passwordAuthEnabled).toBe(false);
  });

  it("rejects a deployment with no browser sign-in method", () => {
    expect(() => loadConfig({ PASSWORD_AUTH_ENABLED: "false" })).toThrow(
      "PASSWORD_AUTH_ENABLED=false",
    );
  });

  it("rejects an invalid password authentication flag", () => {
    expect(() => loadConfig({ PASSWORD_AUTH_ENABLED: "no" })).toThrow(
      "PASSWORD_AUTH_ENABLED must be true or false",
    );
  });
});
