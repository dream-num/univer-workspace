import { describe, expect, it } from "vitest";
import { createSqliteRepositories } from "../../server/src/db/sqlite/open.js";
import { openWorkspaceDatabase } from "../../server/src/db/sqlite/initialize.js";
import {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_REUSE_GRACE_MS,
  REFRESH_TOKEN_TTL_MS,
  createAccessTokenService,
} from "../../server/src/modules/identity/access-tokens.js";
import {
  createIdentityModule,
  type User,
} from "../../server/src/modules/identity/index.js";

const RESOURCE = "https://mcp.example/mcp";
const user: User = { id: "u1", username: "alice", displayName: "Alice", avatarUrl: null };

async function harness() {
  const database = openWorkspaceDatabase(":memory:");
  for (const id of ["u1", "u2"]) {
    database.connection
      .prepare("INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
      .run(id, `name-${id}`, id);
  }
  const clock = { value: 1_000_000 };
  const now = () => clock.value;
  const repositories = createSqliteRepositories(database);
  const tokens = createAccessTokenService({ repository: repositories.accessTokens, now });
  const identity = createIdentityModule({ repository: repositories.identity, sessionTtlMs: 60_000, now });
  await identity.initialize();
  const sessionRow = (cookieValue: string) =>
    database.connection
      .prepare("SELECT expires_at, issued_for_pat_id, issued_for_grant_id FROM login_sessions WHERE id = ?")
      .get(cookieValue.split(".", 1)[0]!) as
      | { expires_at: number; issued_for_pat_id: string | null; issued_for_grant_id: string | null }
      | undefined;
  return { database, clock, tokens, identity, sessionRow };
}

describe("personal access tokens", () => {
  it("creates, lists, verifies and revokes a token and deletes its downstream sessions", async () => {
    const { clock, tokens, identity, sessionRow } = await harness();
    const { token, record } = await tokens.createPersonalToken({ userId: "u1", name: " Laptop " });
    expect(token).toMatch(new RegExp(`^uvw_pat_${record.id}\\.[A-Za-z0-9_-]+$`));
    expect(record).toMatchObject({
      name: "Laptop",
      scopes: ["read", "write", "publish", "worktree:merge"],
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    });
    const listed = await tokens.listPersonalTokens("u1");
    expect(listed).toEqual([record]);
    expect(JSON.stringify(listed)).not.toContain("hash");
    expect(await tokens.listPersonalTokens("u2")).toEqual([]);

    clock.value += 5;
    expect(await tokens.verifySubjectToken(token, { resource: RESOURCE })).toEqual({
      kind: "pat",
      id: record.id,
      userId: "u1",
      scopes: record.scopes,
      expiresAt: null,
    });
    expect((await tokens.listPersonalTokens("u1"))[0]?.lastUsedAt).toBe(clock.value);
    expect(await tokens.verifySubjectToken(token.slice(0, -1) + "x", { resource: RESOURCE })).toBeNull();
    expect(await tokens.verifySubjectToken("uvw_pat_unknown.secret", { resource: RESOURCE })).toBeNull();
    expect(await tokens.verifySubjectToken("workspace-session-cookie", { resource: RESOURCE })).toBeNull();

    const downstream = await identity.issueSession(user, "agent", { issuedFor: { kind: "pat", id: record.id } });
    const unrelated = await identity.issueSession(user, "agent");
    expect(sessionRow(downstream.cookieValue)).toBeDefined();

    expect(await tokens.revokePersonalToken("u2", record.id)).toBe(false);
    expect(await tokens.revokePersonalToken("u1", record.id)).toBe(true);
    expect(await tokens.revokePersonalToken("u1", record.id)).toBe(false);
    expect(await tokens.verifySubjectToken(token, { resource: RESOURCE })).toBeNull();
    expect(sessionRow(downstream.cookieValue)).toBeUndefined();
    expect(sessionRow(unrelated.cookieValue)).toBeDefined();
    expect((await tokens.listPersonalTokens("u1"))[0]?.revokedAt).toBe(clock.value);
  });

  it("rejects an expired token, an unknown scope and an empty name", async () => {
    const { clock, tokens } = await harness();
    const { token } = await tokens.createPersonalToken({
      userId: "u1",
      name: "Short",
      scopes: ["read"],
      expiresAt: clock.value + 100,
    });
    expect((await tokens.verifySubjectToken(token, { resource: RESOURCE }))?.scopes).toEqual(["read"]);
    clock.value += 100;
    expect(await tokens.verifySubjectToken(token, { resource: RESOURCE })).toBeNull();
    await expect(tokens.createPersonalToken({ userId: "u1", name: "Bad", scopes: ["admin"] })).rejects.toThrow(/scope/);
    await expect(tokens.createPersonalToken({ userId: "u1", name: "Bad", scopes: [] })).rejects.toThrow(/scope/);
    await expect(tokens.createPersonalToken({ userId: "u1", name: "  " })).rejects.toThrow(/name/);
    expect((await tokens.createPersonalToken({ userId: "u1", name: "\u{1F511}".repeat(100) })).record.name).toBe("\u{1F511}".repeat(100));
    await expect(tokens.createPersonalToken({ userId: "u1", name: "\u{1F511}".repeat(101) })).rejects.toThrow("Token name must be 1 to 100 characters.");
  });

  it("rejects a non-integer or past expiry", async () => {
    const { clock, tokens } = await harness();
    for (const expiresAt of [clock.value, clock.value - 1, clock.value + 0.5, Number.NaN]) {
      await expect(tokens.createPersonalToken({ userId: "u1", name: "Bad", expiresAt })).rejects.toThrow(/expiresAt/);
    }
    expect(await tokens.listPersonalTokens("u1")).toEqual([]);
  });

  it("rolls back token verification when the exchanged session cannot be inserted", async () => {
    const { database, tokens } = await harness();
    const { token } = await tokens.createPersonalToken({ userId: "u1", name: "test" });
    database.connection.exec(`
      CREATE TRIGGER fail_session BEFORE INSERT ON login_sessions
      BEGIN SELECT RAISE(ABORT, 'session insert failed'); END;
    `);
    await expect(tokens.exchangeSubjectToken(token, RESOURCE, 60_000)).rejects.toThrow("session insert failed");
    expect((await tokens.listPersonalTokens("u1"))[0]?.lastUsedAt).toBeNull();
    expect(database.connection.prepare("SELECT count(*) AS count FROM login_sessions").get()?.count).toBe(0);
  });

  it("checks expiry after acquiring the transaction for session exchange and refresh", async () => {
    const { database, clock, tokens } = await harness();
    const { token } = await tokens.createPersonalToken({ userId: "u1", name: "test", expiresAt: clock.value + 60_000 });
    const grant = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const waiting = createAccessTokenService({
      repository: createSqliteRepositories(database).accessTokens,
      now: () => database.connection.isTransaction ? grant.grant.refreshExpiresAt : clock.value,
    });
    await expect(waiting.exchangeSubjectToken(token, RESOURCE, 60_000)).resolves.toBeNull();
    expect(await waiting.refreshGrant({ refreshToken: grant.refreshToken, clientId: "client", resource: RESOURCE }))
      .toEqual({ ok: false, reason: "expired" });
  });

  it("stores only hashes", async () => {
    const { database, tokens } = await harness();
    const { token } = await tokens.createPersonalToken({ userId: "u1", name: "Laptop" });
    const grant = await tokens.issueGrant({ userId: "u1", clientId: "c", scopes: ["read"], resource: RESOURCE });
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
  it("issues a resource-bound access token that verifies until it expires or the grant is revoked", async () => {
    const { clock, tokens, identity, sessionRow } = await harness();
    const issued = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read", "write"], resource: RESOURCE });
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
      expiresAt: issued.grant.accessExpiresAt,
      clientId: "client",
    };
    expect(await tokens.verifySubjectToken(issued.accessToken, { resource: RESOURCE })).toEqual(subject);
    expect(await tokens.verifySubjectToken(issued.accessToken, { resource: "https://other.example/mcp" })).toBeNull();
    expect(await tokens.verifySubjectToken(issued.refreshToken, { resource: RESOURCE })).toBeNull();

    const downstream = await identity.issueSession(user, "agent", { issuedFor: { kind: "oauth", id: issued.grant.id } });
    expect(await tokens.revokeGrant("u1", issued.grant.id)).toBe(true);
    expect(await tokens.revokeGrant("u1", issued.grant.id)).toBe(false);
    expect(await tokens.verifySubjectToken(issued.accessToken, { resource: RESOURCE })).toBeNull();
    expect(sessionRow(downstream.cookieValue)).toBeUndefined();

    const second = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    clock.value += ACCESS_TOKEN_TTL_MS;
    expect(await tokens.verifySubjectToken(second.accessToken, { resource: RESOURCE })).toBeNull();
  });

  it("rotates the refresh token and retires the previous access token", async () => {
    const { clock, tokens } = await harness();
    const first = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    clock.value += ACCESS_TOKEN_TTL_MS + 1;

    const rotated = await tokens.refreshGrant({ refreshToken: first.refreshToken, clientId: "client", resource: RESOURCE });
    if (!rotated.ok) throw new Error(rotated.reason);
    expect(rotated.grant.id).toBe(first.grant.id);
    expect(rotated.accessToken).not.toBe(first.accessToken);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect(rotated.grant.accessExpiresAt).toBe(clock.value + ACCESS_TOKEN_TTL_MS);
    expect(rotated.grant.refreshExpiresAt).toBe(clock.value + REFRESH_TOKEN_TTL_MS);
    expect(await tokens.verifySubjectToken(first.accessToken, { resource: RESOURCE })).toBeNull();
    expect((await tokens.verifySubjectToken(rotated.accessToken, { resource: RESOURCE }))?.id).toBe(first.grant.id);

    const again = await tokens.refreshGrant({ refreshToken: rotated.refreshToken, clientId: "client", resource: RESOURCE });
    expect(again.ok).toBe(true);
  });

  it("fails a refresh for an unknown, mismatched or expired token", async () => {
    const { clock, tokens } = await harness();
    const issued = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const reason = async (input: { refreshToken: string; clientId: string; resource: string }) => {
      const result = await tokens.refreshGrant(input);
      return result.ok ? "ok" : result.reason;
    };
    expect(await reason({ refreshToken: "uvw_rt_unknown.secret", clientId: "client", resource: RESOURCE })).toBe("invalid");
    expect(await reason({ refreshToken: issued.accessToken, clientId: "client", resource: RESOURCE })).toBe("invalid");
    expect(await reason({ refreshToken: issued.refreshToken.slice(0, -1) + "x", clientId: "client", resource: RESOURCE })).toBe("invalid");
    expect(await reason({ refreshToken: issued.refreshToken, clientId: "other", resource: RESOURCE })).toBe("client_mismatch");
    expect(await reason({ refreshToken: issued.refreshToken, clientId: "client", resource: "https://other.example/mcp" }))
      .toBe("resource_mismatch");
    clock.value += REFRESH_TOKEN_TTL_MS;
    expect(await reason({ refreshToken: issued.refreshToken, clientId: "client", resource: RESOURCE })).toBe("expired");
  });

  it("revokes the whole grant and its sessions when a retired refresh token is replayed after the grace window", async () => {
    const { clock, tokens, identity, sessionRow } = await harness();
    const first = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const second = await tokens.refreshGrant({ refreshToken: first.refreshToken, clientId: "client", resource: RESOURCE });
    if (!second.ok) throw new Error(second.reason);
    const third = await tokens.refreshGrant({ refreshToken: second.refreshToken, clientId: "client", resource: RESOURCE });
    if (!third.ok) throw new Error(third.reason);
    const downstream = await identity.issueSession(user, "agent", { issuedFor: { kind: "oauth", id: first.grant.id } });
    clock.value += REFRESH_REUSE_GRACE_MS;

    expect(await tokens.refreshGrant({ refreshToken: first.refreshToken, clientId: "client", resource: RESOURCE })).toEqual({
      ok: false,
      reason: "reused",
    });
    expect(await tokens.verifySubjectToken(third.accessToken, { resource: RESOURCE })).toBeNull();
    expect(sessionRow(downstream.cookieValue)).toBeUndefined();
    expect(await tokens.refreshGrant({ refreshToken: third.refreshToken, clientId: "client", resource: RESOURCE })).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("reports revoked or expired, not retired or reused, for a retired refresh token on a dead grant", async () => {
    const { clock, tokens } = await harness();
    const request = (refreshToken: string) => tokens.refreshGrant({ refreshToken, clientId: "client", resource: RESOURCE });
    const rotate = async () => {
      const first = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
      const second = await request(first.refreshToken);
      if (!second.ok) throw new Error(second.reason);
      return first;
    };

    const revoked = await rotate();
    await tokens.revokeGrant("u1", revoked.grant.id);
    expect(await request(revoked.refreshToken)).toEqual({ ok: false, reason: "revoked" });
    clock.value += REFRESH_REUSE_GRACE_MS;
    expect(await request(revoked.refreshToken)).toEqual({ ok: false, reason: "revoked" });

    const expired = await rotate();
    clock.value += REFRESH_TOKEN_TTL_MS;
    expect(await request(expired.refreshToken)).toEqual({ ok: false, reason: "expired" });
  });

  it("prunes a grant's refresh history older than the refresh lifetime when it rotates", async () => {
    const { clock, database, tokens } = await harness();
    const request = (refreshToken: string) => tokens.refreshGrant({ refreshToken, clientId: "client", resource: RESOURCE });
    const count = () =>
      (database.connection.prepare("SELECT COUNT(*) AS n FROM oauth_refresh_history").get() as { n: number }).n;
    const first = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const other = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const second = await request(first.refreshToken);
    if (!second.ok || !(await request(other.refreshToken)).ok) throw new Error("rotation failed");

    clock.value += REFRESH_TOKEN_TTL_MS - 1;
    const third = await request(second.refreshToken);
    if (!third.ok) throw new Error(third.reason);
    expect(count()).toBe(3);

    clock.value += 2;
    const fourth = await request(third.refreshToken);
    if (!fourth.ok) throw new Error(fourth.reason);
    expect(count()).toBe(3);
    expect(await request(first.refreshToken)).toEqual({ ok: false, reason: "invalid" });
    expect(await request(second.refreshToken)).toEqual({ ok: false, reason: "retired" });
  });

  it("tolerates a retry of a retired refresh token inside the grace window", async () => {
    const { clock, tokens } = await harness();
    const first = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const rotated = await tokens.refreshGrant({ refreshToken: first.refreshToken, clientId: "client", resource: RESOURCE });
    if (!rotated.ok) throw new Error(rotated.reason);
    clock.value += REFRESH_REUSE_GRACE_MS - 1;

    expect(await tokens.refreshGrant({ refreshToken: first.refreshToken, clientId: "client", resource: RESOURCE })).toEqual({
      ok: false,
      reason: "retired",
    });
    expect((await tokens.verifySubjectToken(rotated.accessToken, { resource: RESOURCE }))?.id).toBe(first.grant.id);
    expect((await tokens.refreshGrant({ refreshToken: rotated.refreshToken, clientId: "client", resource: RESOURCE })).ok).toBe(true);
  });

  it("does not revoke on a refresh token that matches no current or retired hash", async () => {
    const { tokens } = await harness();
    const issued = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const forged = `uvw_rt_${issued.grant.id}.not-the-secret`;
    expect(await tokens.refreshGrant({ refreshToken: forged, clientId: "client", resource: RESOURCE })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect((await tokens.verifySubjectToken(issued.accessToken, { resource: RESOURCE }))?.id).toBe(issued.grant.id);
  });

  it("does not rotate a revoked grant or a client or resource mismatch", async () => {
    const { tokens } = await harness();
    const issued = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    expect(await tokens.refreshGrant({ refreshToken: issued.refreshToken, clientId: "other", resource: RESOURCE })).toEqual({
      ok: false,
      reason: "client_mismatch",
    });
    expect(await tokens.refreshGrant({ refreshToken: issued.refreshToken, clientId: "client", resource: "" })).toEqual({
      ok: false,
      reason: "resource_mismatch",
    });
    expect((await tokens.verifySubjectToken(issued.accessToken, { resource: RESOURCE }))?.id).toBe(issued.grant.id);

    expect((await tokens.refreshGrant({ refreshToken: issued.refreshToken, clientId: "client", resource: RESOURCE })).ok).toBe(true);
    const revoked = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    await tokens.revokeGrant("u1", revoked.grant.id);
    expect(await tokens.refreshGrant({ refreshToken: revoked.refreshToken, clientId: "client", resource: RESOURCE })).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("refreshes without resource while preserving the grant's stored resource", async () => {
    const { tokens } = await harness();
    const issued = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    expect(await tokens.refreshGrant({ refreshToken: issued.refreshToken, clientId: "other" }))
      .toEqual({ ok: false, reason: "client_mismatch" });
    const rotated = await tokens.refreshGrant({ refreshToken: issued.refreshToken, clientId: "client" });
    if (!rotated.ok) throw new Error(rotated.reason);
    expect(rotated.grant.resource).toBe(RESOURCE);
    expect(await tokens.verifySubjectToken(issued.accessToken, { resource: RESOURCE })).toBeNull();
    expect(await tokens.verifySubjectToken(rotated.accessToken, { resource: "https://other.example/mcp" })).toBeNull();
    expect((await tokens.verifySubjectToken(rotated.accessToken, { resource: RESOURCE }))?.id).toBe(issued.grant.id);
    expect(await tokens.refreshGrant({ refreshToken: issued.refreshToken, clientId: "client" }))
      .toEqual({ ok: false, reason: "retired" });
  });

  it("lets only the owner revoke a grant", async () => {
    const { tokens, identity, sessionRow } = await harness();
    const issued = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    const downstream = await identity.issueSession(user, "agent", { issuedFor: { kind: "oauth", id: issued.grant.id } });
    expect(await tokens.revokeGrant("u2", issued.grant.id)).toBe(false);
    expect((await tokens.verifySubjectToken(issued.accessToken, { resource: RESOURCE }))?.id).toBe(issued.grant.id);
    expect(sessionRow(downstream.cookieValue)).toBeDefined();
    expect(await tokens.revokeGrant("u1", issued.grant.id)).toBe(true);
  });

  it("requires a resource to issue a grant and to verify an access token", async () => {
    const { tokens } = await harness();
    for (const resource of ["", "  "]) {
      await expect(tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource })).rejects.toThrow(/resource/);
    }
    const issued = await tokens.issueGrant({ userId: "u1", clientId: "client", scopes: ["read"], resource: RESOURCE });
    expect(await tokens.verifySubjectToken(issued.accessToken, { resource: "" })).toBeNull();
    expect(await tokens.verifySubjectToken(issued.accessToken, {} as { resource: string })).toBeNull();
  });
});

describe("OAuth clients", () => {
  it("persists a dynamically registered client", async () => {
    const { clock, tokens } = await harness();
    const client = await tokens.registerClient({
      clientName: "Cursor",
      redirectUris: ["cursor://anysphere.cursor-mcp/oauth/callback", "cursor://anysphere.cursor-mcp/oauth/callback"],
    });
    if (!client) throw new Error("Client registration failed");
    expect(await tokens.getClient(client.clientId)).toEqual({
      clientId: client.clientId,
      clientName: "Cursor",
      redirectUris: ["cursor://anysphere.cursor-mcp/oauth/callback"],
      createdAt: clock.value,
      lastUsedAt: null,
    });
    clock.value += 1;
    await tokens.issueGrant({ userId: "u1", clientId: client.clientId, scopes: ["read"], resource: RESOURCE });
    expect((await tokens.getClient(client.clientId))?.lastUsedAt).toBe(clock.value);
    expect(await tokens.getClient("missing")).toBeNull();
    await expect(tokens.registerClient({ redirectUris: [] })).rejects.toThrow(/redirect_uris/);
    await expect(tokens.registerClient({ redirectUris: ["not a url"] })).rejects.toThrow(/redirect_uris/);
  });
});

describe("issueSession options", () => {
  it("keeps today's lifetime and token links when omitted and honors ttlMs and issuedFor", async () => {
    const { clock, identity, sessionRow, tokens } = await harness();
    const plain = await identity.issueSession(user, "browser");
    expect(sessionRow(plain.cookieValue)).toEqual({
      expires_at: clock.value + 60_000,
      issued_for_pat_id: null,
      issued_for_grant_id: null,
    });

    const { record } = await tokens.createPersonalToken({ userId: "u1", name: "Laptop" });
    const short = await identity.issueSession(user, "agent", { ttlMs: 30_000, issuedFor: { kind: "pat", id: record.id } });
    expect(sessionRow(short.cookieValue)).toEqual({
      expires_at: clock.value + 30_000,
      issued_for_pat_id: record.id,
      issued_for_grant_id: null,
    });
    expect(await identity.getSession(`workspace_session=${short.cookieValue}`)).toMatchObject({ authenticated: true });

    const grant = await tokens.issueGrant({ userId: "u1", clientId: "c", scopes: ["read"], resource: RESOURCE });
    const linked = await identity.issueSession(user, "agent", { issuedFor: { kind: "oauth", id: grant.grant.id } });
    expect(sessionRow(linked.cookieValue)).toMatchObject({ issued_for_pat_id: null, issued_for_grant_id: grant.grant.id });
  });

  it("rejects a non-positive, non-integer or over-long ttlMs", async () => {
    const { identity } = await harness();
    for (const ttlMs of [0, -1, 1.5, Number.NaN, 60_001]) {
      await expect(identity.issueSession(user, "agent", { ttlMs })).rejects.toThrow(/ttlMs/);
    }
    await expect(async () => identity.issueSession(user, "agent", { ttlMs: 60_000 })).not.toThrow();
  });
});
