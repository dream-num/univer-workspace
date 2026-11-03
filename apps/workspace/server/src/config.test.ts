import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { BUNDLED_UNIVER_LICENSE } from "./integrations/univer/univer-license.js";

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

describe("trial deployment configuration", () => {
  it("is disabled by default", () => {
    expect(loadConfig({}).trialDeployment).toBe(false);
  });

  it("enables the trial notice when configured", () => {
    expect(loadConfig({ TRIAL_DEPLOYMENT: "true" }).trialDeployment).toBe(true);
  });

  it("rejects an invalid trial deployment flag", () => {
    expect(() => loadConfig({ TRIAL_DEPLOYMENT: "yes" })).toThrow(
      "TRIAL_DEPLOYMENT must be true or false",
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

describe("Univer license configuration", () => {
  it("uses the bundled development license by default", () => {
    expect(loadConfig({}).univerLicense).toBe(BUNDLED_UNIVER_LICENSE);
    expect(BUNDLED_UNIVER_LICENSE.license).toMatch(/^\d+-\d+-/);
    expect(BUNDLED_UNIVER_LICENSE.licenseKey).not.toBe("");
  });

  it("accepts a deployment license and key together", () => {
    expect(
      loadConfig({ UNIVER_LICENSE: " license ", UNIVER_LICENSE_KEY: " key " }).univerLicense
    ).toEqual({ license: "license", licenseKey: "key" });
  });

  it("rejects a license without its key", () => {
    expect(() => loadConfig({ UNIVER_LICENSE: "license" })).toThrow(
      "UNIVER_LICENSE and UNIVER_LICENSE_KEY must be configured together"
    );
    expect(() => loadConfig({ UNIVER_LICENSE_KEY: "key" })).toThrow(
      "UNIVER_LICENSE and UNIVER_LICENSE_KEY must be configured together"
    );
  });
});
