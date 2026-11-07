import { describe, expect, it } from "vitest";
import { openWorkspaceDatabase } from "../../server/src/db/initialize.js";
import {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_REUSE_GRACE_MS,
  REFRESH_TOKEN_TTL_MS,
  createAccessTokenService,
} from "../../server/src/modules/identity/access-tokens.js";
import {
  IdentityRepository,
  createIdentityModule,
  type User,
} from "../../server/src/modules/identity/index.js";

const RESOURCE = "https://mcp.example/mcp";
const user: User = { id: "u1", username: "alice", displayName: "Alice", avatarUrl: null };

function harness() {
  const database = openWorkspaceDatabase(":memory:");
  for (const id of ["u1", "u2"]) {
    database.connection
      .prepare("INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
      .run(id, `name-${id}`, id);
  }
  const clock = { value: 1_000_000 };
  const now = () => clock.value;
  const tokens = createAccessTokenService({ database, now });
  const identity = createIdentityModule({ repository: new IdentityRepository(database), sessionTtlMs: 60_000, now });
  const sessionRow = (cookieValue: string) =>
    database.connection
      .prepare("SELECT expires_at, issued_for_pat_id, issued_for_grant_id FROM login_sessions WHERE id = ?")
      .get(cookieValue.split(".", 1)[0]) as
      | { expires_at: number; issued_for_pat_id: string | null; issued_for_grant_id: string | null }
      | undefined;
  return { database, clock, tokens, identity, sessionRow };
}

describe("personal access tokens", () => {
  it("creates, lists, verifies and revokes a token and deletes its downstream sessions", () => {
    const { clock, tokens, identity, sessionRow } = harness();
    const { token, record } = tokens.createPersonalToken({ userId: "u1", name: " Laptop " });
    expect(token).toMatch(new RegExp(`^uvw_pat_${record.id}\\.[A-Za-z0-9_-]+$`));
    expect(record).toMatchObject({
      name: "Laptop",
      scopes: ["read", "write", "publish", "worktree:merge"],
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    });
    const listed = tokens.listPersonalTokens("u1");
    expect(listed).toEqual([record]);
    expect(JSON.stringify(listed)).not.toContain("hash");
    expect(tokens.listPersonalTokens("u2")).toEqual([]);

    clock.value += 5;
    expect(tokens.verifySubjectToken(token, { resource: RESOURCE })).toEqual({
      kind: "pat",
      id: record.id,
      userId: "u1",
      scopes: record.scopes,
    });
    expect(tokens.listPersonalTokens("u1")[0]?.lastUsedAt).toBe(clock.value);
    expect(tokens.verifySubjectToken(token.slice(0, -1) + "x", { resource: RESOURCE })).toBeNull();
    expect(tokens.verifySubjectToken("uvw_pat_unknown.secret", { resource: RESOURCE })).toBeNull();
    expect(tokens.verifySubjectToken("workspace-session-cookie", { resource: RESOURCE })).toBeNull();

    const downstream = identity.issueSession(user, "agent", { issuedFor: { kind: "pat", id: record.id } });
    const unrelated = identity.issueSession(user, "agent");
    expect(sessionRow(downstream.cookieValue)).toBeDefined();

    expect(tokens.revokePersonalToken("u2", record.id)).toBe(false);
    expect(tokens.revokePersonalToken("u1", record.id)).toBe(true);
    expect(tokens.revokePersonalToken("u1", record.id)).toBe(false);
    expect(tokens.verifySubjectToken(token, { resource: RESOURCE })).toBeNull();
    expect(sessionRow(downstream.cookieValue)).toBeUndefined();
    expect(sessionRow(unrelated.cookieValue)).toBeDefined();
    expect(tokens.listPersonalTokens("u1")[0]?.revokedAt).toBe(clock.value);
  });

  it("rejects an expired token, an unknown scope and an empty name", () => {
    const { clock, tokens } = harness();
    const { token } = tokens.createPersonalToken({
      userId: "u1",
      name: "Short",
      scopes: ["read"],
      expiresAt: clock.value + 100,
    });
    expect(tokens.verifySubjectToken(token, { resource: RESOURCE })?.scopes).toEqual(["read"]);
    clock.value += 100;
    expect(tokens.verifySubjectToken(token, { resource: RESOURCE })).toBeNull();
    expect(() => tokens.createPersonalToken({ userId: "u1", name: "Bad", scopes: ["admin"] })).toThrow(/scope/);
    expect(() => tokens.createPersonalToken({ userId: "u1", name: "Bad", scopes: [] })).toThrow(/scope/);
    expect(() => tokens.createPersonalToken({ userId: "u1", name: "  " })).toThrow(/name/);
  });

  it("rejects a non-integer or past expiry", () => {
    const { clock, tokens } = harness();
    for (const expiresAt of [clock.value, clock.value - 1, clock.value + 0.5, Number.NaN]) {
      expect(() => tokens.createPersonalToken({ userId: "u1", name: "Bad", expiresAt })).toThrow(/expiresAt/);
    }
    expect(tokens.listPersonalTokens("u1")).toEqual([]);
  });

  it("stores only hashes", () => {
    const { database, tokens } = harness();
    const { token } = tokens.createPersonalToken({ userId: "u1", name: "Laptop" });
    const grant = tokens.issueGrant({ userId: "u1", clientId: "c", scopes: ["read"], resource: RESOURCE });
    const stored = JSON.stringify([
      database.connection.prepare("SELECT * FROM personal_access_tokens").all(),
      database.connection.prepare("SELECT * FROM oauth_grants").all(),
    ]);
    for (const plaintext of [token, grant.accessToken, grant.refreshToken]) {
      expect(stored).not.toContain(plaintext.slice(plaintext.indexOf(".") + 1));
    }
  });
});

describe("OAuth grants", () => {
  it("issues a resource-bound access token that verifies until it expires or the grant is revoked", () => {
    const { clock, tokens, identity, sessionRow } = harness();
    const issued = tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read", "write"], resource: RESOURCE });
    expect(issued.accessToken).toMatch(/^uvw_at_/);
    expect(issued.refreshToken).toMatch(/^uvw_rt_/);
    expect(issued.expiresIn).toBe(ACCESS_TOKEN_TTL_MS / 1000);
    expect(issued.grant).toMatchObject({
      userId: "u1",
      clientId: "client",
      scopes: ["read", "write"],
      resource: RESOURCE,
      accessExpiresAt: clock.value + ACCESS_TOKEN_TTL_MS,
      refreshExpiresAt: clock.value + REFRESH_TOKEN_TTL_MS,
      revokedAt: null,
    });

    const subject = {
      kind: "oauth",
      id: issued.grant.id,
      userId: "u1",
      scopes: ["read", "write"],
      clientId: "client",
    };
    expect(tokens.verifySubjectToken(issued.accessToken, { resource: RESOURCE })).toEqual(subject);
    expect(tokens.verifySubjectToken(issued.accessToken, { resource: "https://other.example/mcp" })).toBeNull();
    expect(tokens.verifySubjectToken(issued.refreshToken, { resource: RESOURCE })).toBeNull();

    const downstream = identity.issueSession(user, "agent", { issuedFor: { kind: "oauth", id: issued.grant.id } });
    expect(tokens.revokeGrant("u1", issued.grant.id)).toBe(true);
    expect(tokens.revokeGrant("u1", issued.grant.id)).toBe(false);
    expect(tokens.verifySubjectToken(issued.accessToken, { resource: RESOURCE })).toBeNull();
    expect(sessionRow(downstream.cookieValue)).toBeUndefined();

    const second = tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    clock.value += ACCESS_TOKEN_TTL_MS;
    expect(tokens.verifySubjectToken(second.accessToken, { resource: RESOURCE })).toBeNull();
  });

  it("rotates the refresh token and retires the previous access token", () => {
    const { clock, tokens } = harness();
    const first = tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    clock.value += ACCESS_TOKEN_TTL_MS + 1;

    const rotated = tokens.refreshGrant({ refreshToken: first.refreshToken, clientId: "client", resource: RESOURCE });
    if (!rotated.ok) throw new Error(rotated.reason);
    expect(rotated.grant.id).toBe(first.grant.id);
    expect(rotated.accessToken).not.toBe(first.accessToken);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect(rotated.grant.accessExpiresAt).toBe(clock.value + ACCESS_TOKEN_TTL_MS);
    expect(rotated.grant.refreshExpiresAt).toBe(clock.value + REFRESH_TOKEN_TTL_MS);
    expect(tokens.verifySubjectToken(first.accessToken, { resource: RESOURCE })).toBeNull();
    expect(tokens.verifySubjectToken(rotated.accessToken, { resource: RESOURCE })?.id).toBe(first.grant.id);

    const again = tokens.refreshGrant({ refreshToken: rotated.refreshToken, clientId: "client", resource: RESOURCE });
    expect(again.ok).toBe(true);
  });

  it("fails a refresh for an unknown, mismatched or expired token", () => {
    const { clock, tokens } = harness();
    const issued = tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const reason = (input: { refreshToken: string; clientId: string; resource: string }) => {
      const result = tokens.refreshGrant(input);
      return result.ok ? "ok" : result.reason;
    };
    expect(reason({ refreshToken: "uvw_rt_unknown.secret", clientId: "client", resource: RESOURCE })).toBe("invalid");
    expect(reason({ refreshToken: issued.accessToken, clientId: "client", resource: RESOURCE })).toBe("invalid");
    expect(reason({ refreshToken: issued.refreshToken.slice(0, -1) + "x", clientId: "client", resource: RESOURCE })).toBe("invalid");
    expect(reason({ refreshToken: issued.refreshToken, clientId: "other", resource: RESOURCE })).toBe("client_mismatch");
    expect(reason({ refreshToken: issued.refreshToken, clientId: "client", resource: "https://other.example/mcp" }))
      .toBe("resource_mismatch");
    clock.value += REFRESH_TOKEN_TTL_MS;
    expect(reason({ refreshToken: issued.refreshToken, clientId: "client", resource: RESOURCE })).toBe("expired");
  });

  it("revokes the whole grant and its sessions when a retired refresh token is replayed after the grace window", () => {
    const { clock, tokens, identity, sessionRow } = harness();
    const first = tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const second = tokens.refreshGrant({ refreshToken: first.refreshToken, clientId: "client", resource: RESOURCE });
    if (!second.ok) throw new Error(second.reason);
    const third = tokens.refreshGrant({ refreshToken: second.refreshToken, clientId: "client", resource: RESOURCE });
    if (!third.ok) throw new Error(third.reason);
    const downstream = identity.issueSession(user, "agent", { issuedFor: { kind: "oauth", id: first.grant.id } });
    clock.value += REFRESH_REUSE_GRACE_MS;

    expect(tokens.refreshGrant({ refreshToken: first.refreshToken, clientId: "client", resource: RESOURCE })).toEqual({
      ok: false,
      reason: "reused",
    });
    expect(tokens.verifySubjectToken(third.accessToken, { resource: RESOURCE })).toBeNull();
    expect(sessionRow(downstream.cookieValue)).toBeUndefined();
    expect(tokens.refreshGrant({ refreshToken: third.refreshToken, clientId: "client", resource: RESOURCE })).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("reports revoked or expired, not retired or reused, for a retired refresh token on a dead grant", () => {
    const { clock, tokens } = harness();
    const request = (refreshToken: string) => tokens.refreshGrant({ refreshToken, clientId: "client", resource: RESOURCE });
    const rotate = () => {
      const first = tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
      const second = request(first.refreshToken);
      if (!second.ok) throw new Error(second.reason);
      return first;
    };

    const revoked = rotate();
    tokens.revokeGrant("u1", revoked.grant.id);
    expect(request(revoked.refreshToken)).toEqual({ ok: false, reason: "revoked" });
    clock.value += REFRESH_REUSE_GRACE_MS;
    expect(request(revoked.refreshToken)).toEqual({ ok: false, reason: "revoked" });

    const expired = rotate();
    clock.value += REFRESH_TOKEN_TTL_MS;
    expect(request(expired.refreshToken)).toEqual({ ok: false, reason: "expired" });
  });

  it("prunes a grant's refresh history older than the refresh lifetime when it rotates", () => {
    const { clock, database, tokens } = harness();
    const request = (refreshToken: string) => tokens.refreshGrant({ refreshToken, clientId: "client", resource: RESOURCE });
    const count = () =>
      (database.connection.prepare("SELECT COUNT(*) AS n FROM oauth_refresh_history").get() as { n: number }).n;
    const first = tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const other = tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const second = request(first.refreshToken);
    if (!second.ok || !request(other.refreshToken).ok) throw new Error("rotation failed");

    clock.value += REFRESH_TOKEN_TTL_MS - 1;
    const third = request(second.refreshToken);
    if (!third.ok) throw new Error(third.reason);
    expect(count()).toBe(3);

    clock.value += 2;
    const fourth = request(third.refreshToken);
    if (!fourth.ok) throw new Error(fourth.reason);
    expect(count()).toBe(3);
    expect(request(first.refreshToken)).toEqual({ ok: false, reason: "invalid" });
    expect(request(second.refreshToken)).toEqual({ ok: false, reason: "retired" });
  });

  it("tolerates a retry of a retired refresh token inside the grace window", () => {
    const { clock, tokens } = harness();
    const first = tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const rotated = tokens.refreshGrant({ refreshToken: first.refreshToken, clientId: "client", resource: RESOURCE });
    if (!rotated.ok) throw new Error(rotated.reason);
    clock.value += REFRESH_REUSE_GRACE_MS - 1;

    expect(tokens.refreshGrant({ refreshToken: first.refreshToken, clientId: "client", resource: RESOURCE })).toEqual({
      ok: false,
      reason: "retired",
    });
    expect(tokens.verifySubjectToken(rotated.accessToken, { resource: RESOURCE })?.id).toBe(first.grant.id);
    expect(tokens.refreshGrant({ refreshToken: rotated.refreshToken, clientId: "client", resource: RESOURCE }).ok).toBe(true);
  });

  it("does not revoke on a refresh token that matches no current or retired hash", () => {
    const { tokens } = harness();
    const issued = tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const forged = `uvw_rt_${issued.grant.id}.not-the-secret`;
    expect(tokens.refreshGrant({ refreshToken: forged, clientId: "client", resource: RESOURCE })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(tokens.verifySubjectToken(issued.accessToken, { resource: RESOURCE })?.id).toBe(issued.grant.id);
  });

  it("does not rotate a revoked grant or a client or resource mismatch", () => {
    const { tokens } = harness();
    const issued = tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    expect(tokens.refreshGrant({ refreshToken: issued.refreshToken, clientId: "other", resource: RESOURCE })).toEqual({
      ok: false,
      reason: "client_mismatch",
    });
    expect(tokens.refreshGrant({ refreshToken: issued.refreshToken, clientId: "client", resource: "" })).toEqual({
      ok: false,
      reason: "resource_mismatch",
    });
    const missing = { refreshToken: issued.refreshToken, clientId: "client" } as unknown as Parameters<typeof tokens.refreshGrant>[0];
    expect(tokens.refreshGrant(missing)).toEqual({ ok: false, reason: "resource_mismatch" });
    expect(tokens.verifySubjectToken(issued.accessToken, { resource: RESOURCE })?.id).toBe(issued.grant.id);

    expect(tokens.refreshGrant({ refreshToken: issued.refreshToken, clientId: "client", resource: RESOURCE }).ok).toBe(true);
    const revoked = tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    tokens.revokeGrant("u1", revoked.grant.id);
    expect(tokens.refreshGrant({ refreshToken: revoked.refreshToken, clientId: "client", resource: RESOURCE })).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("lets only the owner revoke a grant", () => {
    const { tokens, identity, sessionRow } = harness();
    const issued = tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const downstream = identity.issueSession(user, "agent", { issuedFor: { kind: "oauth", id: issued.grant.id } });
    expect(tokens.revokeGrant("u2", issued.grant.id)).toBe(false);
    expect(tokens.verifySubjectToken(issued.accessToken, { resource: RESOURCE })?.id).toBe(issued.grant.id);
    expect(sessionRow(downstream.cookieValue)).toBeDefined();
    expect(tokens.revokeGrant("u1", issued.grant.id)).toBe(true);
  });

  it("requires a resource to issue a grant and to verify an access token", () => {
    const { tokens } = harness();
    for (const resource of ["", "  "]) {
      expect(() => tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource })).toThrow(/resource/);
    }
    const issued = tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    expect(tokens.verifySubjectToken(issued.accessToken, { resource: "" })).toBeNull();
    expect(tokens.verifySubjectToken(issued.accessToken, {} as { resource: string })).toBeNull();
  });
});

describe("OAuth clients", () => {
  it("persists a dynamically registered client", () => {
    const { clock, tokens } = harness();
    const client = tokens.registerClient({
      clientName: "Cursor",
      redirectUris: ["cursor://anysphere.cursor-mcp/oauth/callback", "cursor://anysphere.cursor-mcp/oauth/callback"],
    });
    expect(tokens.getClient(client.clientId)).toEqual({
      clientId: client.clientId,
      clientName: "Cursor",
      redirectUris: ["cursor://anysphere.cursor-mcp/oauth/callback"],
      createdAt: clock.value,
      lastUsedAt: null,
    });
    clock.value += 1;
    tokens.issueGrant({ userId: "u1", clientId: client.clientId, scopes: ["read"], resource: RESOURCE });
    expect(tokens.getClient(client.clientId)?.lastUsedAt).toBe(clock.value);
    expect(tokens.getClient("missing")).toBeNull();
    expect(() => tokens.registerClient({ redirectUris: [] })).toThrow(/redirect_uris/);
    expect(() => tokens.registerClient({ redirectUris: ["not a url"] })).toThrow(/redirect_uris/);
  });
});

describe("issueSession options", () => {
  it("keeps today's lifetime and token links when omitted and honors ttlMs and issuedFor", () => {
    const { clock, identity, sessionRow, tokens } = harness();
    const plain = identity.issueSession(user, "browser");
    expect(sessionRow(plain.cookieValue)).toEqual({
      expires_at: clock.value + 60_000,
      issued_for_pat_id: null,
      issued_for_grant_id: null,
    });

    const { record } = tokens.createPersonalToken({ userId: "u1", name: "Laptop" });
    const short = identity.issueSession(user, "agent", { ttlMs: 30_000, issuedFor: { kind: "pat", id: record.id } });
    expect(sessionRow(short.cookieValue)).toEqual({
      expires_at: clock.value + 30_000,
      issued_for_pat_id: record.id,
      issued_for_grant_id: null,
    });
    expect(identity.getSession(`workspace_session=${short.cookieValue}`)).toMatchObject({ authenticated: true });

    const grant = tokens.issueGrant({ userId: "u1", clientId: "c", scopes: ["read"], resource: RESOURCE });
    const linked = identity.issueSession(user, "agent", { issuedFor: { kind: "oauth", id: grant.grant.id } });
    expect(sessionRow(linked.cookieValue)).toMatchObject({ issued_for_pat_id: null, issued_for_grant_id: grant.grant.id });
  });

  it("rejects a non-positive, non-integer or over-long ttlMs", () => {
    const { identity } = harness();
    for (const ttlMs of [0, -1, 1.5, Number.NaN, 60_001]) {
      expect(() => identity.issueSession(user, "agent", { ttlMs })).toThrow(/ttlMs/);
    }
    expect(() => identity.issueSession(user, "agent", { ttlMs: 60_000 })).not.toThrow();
  });
});
