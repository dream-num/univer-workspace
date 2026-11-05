import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceDatabase } from "../../server/src/db/database.js";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import type { EmailMessage, EmailSender } from "../../server/src/integrations/email/index.js";
import {
  createIdentityModule,
  IdentityRepository,
  type IdentityModule,
} from "../../server/src/modules/identity/index.js";

const workspaces: WorkspaceDatabase[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) workspace.close();
});

describe("passwordless Email sign-in", () => {
  it("emails a code, then creates the User, Personal Space, and session on verification", async () => {
    const harness = createHarness();

    await expect(
      harness.identity.requestEmailLoginCode({ email: "Alice@Example.com" })
    ).resolves.toEqual({ expiresIn: 600, resendAfter: 60 });
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]?.to).toBe("alice@example.com");
    const message = harness.sent[0]!;
    expect(message.subject).toBe(
      `Univer Workspace sign-in code: ${codeFrom(message)}`
    );
    expect(message.text).toContain("Your sign-in code is");
    expect(message.html).toContain('<html lang="en">');
    expect(
      `${message.subject}\n${message.text}\n${message.html}`
    ).not.toMatch(/[\u3400-\u9fff]/u);
    expect(tableCount(harness.database, "users")).toBe(0);
    const stored = harness.database
      .prepare("SELECT code_hash FROM email_login_codes")
      .get() as { readonly code_hash: string };
    expect(stored.code_hash).toMatch(/^scrypt\$/);
    expect(stored.code_hash).not.toContain(codeFrom(harness.sent[0]!));

    const issued = await harness.identity.loginWithEmailCode({
      email: "alice@example.com",
      code: codeFrom(harness.sent[0]!),
    });

    expect(issued.view).toMatchObject({
      authenticated: true,
      emailAuthEnabled: true,
      user: {
        username: "alice",
        displayName: "alice",
      },
      authenticationMethods: {
        password: false,
        email: "alice@example.com",
        externalIdentities: [],
      },
    });
    expect(tableCount(harness.database, "users")).toBe(1);
    expect(
      harness.database
        .prepare("SELECT email FROM users WHERE id = ?")
        .get(issued.view.user.id)
    ).toEqual({ email: "alice@example.com" });
    expect(tableCount(harness.database, "spaces")).toBe(1);
    expect(tableCount(harness.database, "login_sessions")).toBe(1);
    expect(
      harness.identity.getSession(
        `${harness.identity.cookieName}=${issued.cookieValue}`
      )
    ).toMatchObject({
      authenticated: true,
      user: { id: issued.view.user.id },
    });
    expect(
      harness.database
        .prepare("SELECT consumed_at FROM email_login_codes")
        .get()
    ).toMatchObject({ consumed_at: harness.now() });
  });

  it("reuses the same User for later sign-ins with the same address", async () => {
    const harness = createHarness();
    const first = await signIn(harness, "alice@example.com");
    harness.advance(61_000);
    const second = await signIn(harness, "ALICE@example.com");

    expect(second.view.user.id).toBe(first.view.user.id);
    expect(tableCount(harness.database, "users")).toBe(1);
    expect(
      harness.database
        .prepare("SELECT email FROM users WHERE id = ?")
        .get(second.view.user.id)
    ).toEqual({ email: "alice@example.com" });
    expect(tableCount(harness.database, "spaces")).toBe(1);
    expect(tableCount(harness.database, "login_sessions")).toBe(2);
  });

  it("accepts only the newest code for an address", async () => {
    const harness = createHarness();
    await harness.identity.requestEmailLoginCode({
      email: "alice@example.com",
    });
    const firstCode = codeFrom(harness.sent[0]!);
    harness.advance(61_000);
    await harness.identity.requestEmailLoginCode({
      email: "alice@example.com",
    });
    const secondCode = codeFrom(harness.sent[1]!);

    await expect(
      harness.identity.loginWithEmailCode({
        email: "alice@example.com",
        code: firstCode,
      })
    ).rejects.toMatchObject({ code: "INVALID_EMAIL_CODE" });
    await expect(
      harness.identity.loginWithEmailCode({
        email: "alice@example.com",
        code: secondCode,
      })
    ).resolves.toMatchObject({ view: { authenticated: true } });
  });

  it("derives a unique Username from the email local part", async () => {
    const harness = createHarness();
    await harness.identity.registerWithPassword({
      username: "alice",
      displayName: "Alice",
      password: "correct horse battery staple",
    });
    const issued = await signIn(harness, "alice@example.com");
    expect(issued.view.user.username).toMatch(/^alice-[0-9a-f]{6}$/u);
    expect(issued.view.user.displayName).toBe("alice");

    harness.advance(61_000);
    const tagged = await signIn(harness, "john+tag@example.com");
    expect(tagged.view.user.username).toBe("john.tag");
    expect(tagged.view.user.displayName).toBe("john+tag");
  });

  it("rejects an incorrect code and locks the code after five attempts", async () => {
    const harness = createHarness();
    await harness.identity.requestEmailLoginCode({
      email: "alice@example.com",
    });
    const code = codeFrom(harness.sent[0]!);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        harness.identity.loginWithEmailCode({
          email: "alice@example.com",
          code: attempt === 4 ? "000000" : wrongCode(code, attempt),
        })
      ).rejects.toMatchObject({ code: "INVALID_EMAIL_CODE", status: 400 });
    }
    await expect(
      harness.identity.loginWithEmailCode({
        email: "alice@example.com",
        code,
      })
    ).rejects.toMatchObject({
      code: "INVALID_EMAIL_CODE",
      status: 400,
      message: expect.stringContaining("Too many incorrect attempts"),
    });
    expect(tableCount(harness.database, "users")).toBe(0);
    expect(tableCount(harness.database, "email_login_codes")).toBe(0);
  });

  it("rejects an expired code", async () => {
    const harness = createHarness();
    await harness.identity.requestEmailLoginCode({
      email: "alice@example.com",
    });
    const code = codeFrom(harness.sent[0]!);
    harness.advance(10 * 60 * 1_000 + 1);
    await expect(
      harness.identity.loginWithEmailCode({
        email: "alice@example.com",
        code,
      })
    ).rejects.toMatchObject({ code: "INVALID_EMAIL_CODE", status: 400 });
    expect(tableCount(harness.database, "users")).toBe(0);
  });

  it("rate limits code requests per address", async () => {
    const harness = createHarness();
    await harness.identity.requestEmailLoginCode({
      email: "alice@example.com",
    });
    await expect(
      harness.identity.requestEmailLoginCode({ email: "alice@example.com" })
    ).rejects.toMatchObject({ code: "EMAIL_CODE_RATE_LIMITED", status: 429 });

    for (let request = 0; request < 4; request += 1) {
      harness.advance(61_000);
      await harness.identity.requestEmailLoginCode({
        email: "alice@example.com",
      });
    }
    harness.advance(61_000);
    await expect(
      harness.identity.requestEmailLoginCode({ email: "alice@example.com" })
    ).rejects.toMatchObject({
      code: "EMAIL_CODE_RATE_LIMITED",
      status: 429,
      message: expect.stringContaining("Too many"),
    });
    expect(harness.sent).toHaveLength(5);
  });

  it("removes the code when the provider cannot deliver it", async () => {
    const harness = createHarness({
      send: async () => {
        throw new Error("SMTP unavailable");
      },
    });
    await expect(
      harness.identity.requestEmailLoginCode({ email: "alice@example.com" })
    ).rejects.toMatchObject({ code: "EMAIL_DELIVERY_FAILED", status: 503 });
    expect(tableCount(harness.database, "email_login_codes")).toBe(0);
  });

  it("refuses Email sign-in when no provider is configured", async () => {
    const harness = createHarness({ sender: null });
    await expect(
      harness.identity.requestEmailLoginCode({ email: "alice@example.com" })
    ).rejects.toMatchObject({ code: "EMAIL_AUTH_DISABLED", status: 403 });
    await expect(
      harness.identity.loginWithEmailCode({
        email: "alice@example.com",
        code: "123456",
      })
    ).rejects.toMatchObject({ code: "EMAIL_AUTH_DISABLED", status: 403 });
    expect(harness.identity.getSession(undefined)).toMatchObject({
      authenticated: false,
      emailAuthEnabled: false,
    });
  });

  it("rejects malformed addresses and codes before sending", async () => {
    const harness = createHarness();
    await expect(
      harness.identity.requestEmailLoginCode({ email: "not-an-email" })
    ).rejects.toMatchObject({ code: "INVALID_INPUT", field: "email" });
    await expect(
      harness.identity.requestEmailLoginCode({ email: "a@b" })
    ).rejects.toMatchObject({ code: "INVALID_INPUT", field: "email" });
    await expect(
      harness.identity.loginWithEmailCode({
        email: "alice@example.com",
        code: "12345",
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT", field: "code" });
    expect(harness.sent).toHaveLength(0);
  });
});

function createHarness(
  options: { readonly sender?: EmailSender | null; readonly send?: EmailSender["send"] } = {}
): {
  readonly database: DatabaseSync;
  readonly identity: IdentityModule;
  readonly sent: EmailMessage[];
  readonly now: () => number;
  readonly advance: (milliseconds: number) => void;
} {
  const workspace = openWorkspaceDatabase(":memory:");
  workspaces.push(workspace);
  const sent: EmailMessage[] = [];
  let currentTime = 1_000_000;
  const sender: EmailSender | null =
    options.sender === null
      ? null
      : {
          send: async (message) => {
            sent.push(message);
            await options.send?.(message);
          },
        };
  const identity = createIdentityModule({
    repository: new IdentityRepository(workspace),
    sessionTtlMs: 60_000,
    ...(sender ? { emailSender: sender } : {}),
    now: () => currentTime,
  });
  return {
    database: workspace.connection,
    identity,
    sent,
    now: () => currentTime,
    advance: (milliseconds) => {
      currentTime += milliseconds;
    },
  };
}

async function signIn(
  harness: ReturnType<typeof createHarness>,
  email: string
) {
  await harness.identity.requestEmailLoginCode({ email });
  return harness.identity.loginWithEmailCode({
    email,
    code: codeFrom(harness.sent[harness.sent.length - 1]!),
  });
}

function codeFrom(message: EmailMessage): string {
  const match = message.text.match(/\b([0-9]{6})\b/u);
  if (!match?.[1]) throw new Error("The message does not contain a code.");
  return match[1];
}

function wrongCode(code: string, attempt: number): string {
  const digits = code.split("");
  digits[attempt % digits.length] =
    digits[attempt % digits.length] === "0" ? "1" : "0";
  return digits.join("");
}

function tableCount(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    readonly count: number;
  };
  return row.count;
}
