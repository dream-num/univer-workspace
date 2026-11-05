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

describe("Google OAuth configuration", () => {
  it("enables Google OAuth when every credential is configured", () => {
    const config = loadConfig({
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_CALLBACK_URL: "https://workspace.example.test/api/auth/google/callback",
    });

    expect(config.googleOAuth).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      callbackUrl: "https://workspace.example.test/api/auth/google/callback",
    });
  });

  it("rejects a partial Google OAuth configuration", () => {
    expect(() =>
      loadConfig({
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
      }),
    ).toThrow(
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL",
    );
  });

  it("keeps Google OAuth disabled when no credential is configured", () => {
    expect(loadConfig({}).googleOAuth).toBeNull();
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

  it("disables password authentication when Google OAuth remains available", () => {
    const config = loadConfig({
      PASSWORD_AUTH_ENABLED: "false",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_CALLBACK_URL: "https://workspace.example.test/api/auth/google/callback",
    });

    expect(config.passwordAuthEnabled).toBe(false);
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

describe("Email sign-in configuration", () => {
  it("keeps Email sign-in disabled by default", () => {
    expect(loadConfig({}).emailAuth).toBeNull();
  });

  it("builds an SMTP provider from discrete settings", () => {
    const config = loadConfig({
      EMAIL_SMTP_HOST: "email-smtp.us-east-1.amazonaws.com",
      EMAIL_SMTP_PORT: "465",
      EMAIL_SMTP_USER: "smtp-user",
      EMAIL_SMTP_PASSWORD: "smtp-password",
      EMAIL_FROM: "no-reply@example.com",
      EMAIL_FROM_NAME: "Univer Workspace",
    });

    expect(config.emailAuth).toEqual({
      provider: "smtp",
      from: { address: "no-reply@example.com", name: "Univer Workspace" },
      smtp: {
        host: "email-smtp.us-east-1.amazonaws.com",
        port: 465,
        secure: true,
        username: "smtp-user",
        password: "smtp-password",
      },
    });
  });

  it("defaults SMTP to port 587 with STARTTLS", () => {
    const config = loadConfig({ EMAIL_SMTP_HOST: "smtp.example.com" });

    expect(config.emailAuth).toMatchObject({
      provider: "smtp",
      from: { address: "no-reply@localhost" },
      smtp: { host: "smtp.example.com", port: 587, secure: false },
    });
  });

  it("uses the console provider when Email sign-in is enabled without SMTP", () => {
    expect(loadConfig({ EMAIL_AUTH_ENABLED: "true" }).emailAuth).toEqual({
      provider: "console",
      from: { address: "no-reply@localhost" },
    });
  });

  it("disables Email sign-in even when SMTP is configured", () => {
    expect(
      loadConfig({
        EMAIL_AUTH_ENABLED: "false",
        EMAIL_SMTP_HOST: "smtp.example.com",
      }).emailAuth
    ).toBeNull();
  });

  it("rejects an unknown provider", () => {
    expect(() => loadConfig({ EMAIL_PROVIDER: "sendgrid" })).toThrow(
      'EMAIL_PROVIDER must be "smtp" or "console"'
    );
  });

  it("rejects an incomplete SMTP configuration", () => {
    expect(() => loadConfig({ EMAIL_SMTP_USER: "smtp-user" })).toThrow(
      "EMAIL_PROVIDER=smtp requires EMAIL_SMTP_HOST"
    );
    expect(() =>
      loadConfig({
        EMAIL_SMTP_HOST: "smtp.example.com",
        EMAIL_SMTP_USER: "smtp-user",
      })
    ).toThrow("EMAIL_SMTP_USER and EMAIL_SMTP_PASSWORD");
  });

  it("rejects an invalid sender address", () => {
    expect(() =>
      loadConfig({
        EMAIL_AUTH_ENABLED: "true",
        EMAIL_FROM: "not-an-address",
      })
    ).toThrow("EMAIL_FROM must be an email address");
  });

  it("counts Email sign-in as a browser sign-in method", () => {
    const config = loadConfig({
      PASSWORD_AUTH_ENABLED: "false",
      EMAIL_AUTH_ENABLED: "true",
    });

    expect(config.passwordAuthEnabled).toBe(false);
    expect(config.emailAuth?.provider).toBe("console");
  });

  it("rejects a deployment with no browser sign-in method", () => {
    expect(() =>
      loadConfig({
        PASSWORD_AUTH_ENABLED: "false",
        EMAIL_AUTH_ENABLED: "false",
      })
    ).toThrow("PASSWORD_AUTH_ENABLED=false");
  });
});
