import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createObservationModule,
  ObservationDatabase,
  ObservationRepository,
} from "../../server/src/modules/observation/index.js";

const databases: ObservationDatabase[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Observer identity", () => {
  it("initializes the first GitHub member with a one-time setup token", async () => {
    const database = new ObservationDatabase(":memory:");
    databases.push(database);
    let exchangedIdentity = githubIdentity("101", "first-member");
    const observation = createObservationModule({
      repository: new ObservationRepository(database),
      setupToken: "a".repeat(32),
      oauthStateSecret: "oauth-state-secret".repeat(2),
      sessionTtlMs: 60_000,
      githubOAuthProvider: {
        authorizationUrl({ state }) {
          return `https://github.test/authorize?state=${encodeURIComponent(state)}`;
        },
        async exchangeCode() {
          return exchangedIdentity;
        },
      },
      async resolveGitHubIdentity(login) {
        return githubIdentity("202", login);
      },
    });

    expect(observation.status(undefined)).toMatchObject({
      initialized: false,
      authenticated: false,
      setupTokenConfigured: true,
    });
    expect(() => observation.startOAuth({ mode: "setup", setupToken: "wrong" })).toThrowError(
      expect.objectContaining({ code: "OBSERVER_SETUP_TOKEN_INVALID" })
    );

    const started = observation.startOAuth({ mode: "setup", setupToken: "a".repeat(32) });
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    const finished = await observation.finishOAuth({
      code: "code",
      state,
      providerError: undefined,
      cookieHeader: `${observation.oauthCookieName}=${started.cookieValue}`,
    });
    const sessionCookie = `${observation.cookieName}=${finished.sessionCookieValue}`;
    expect(observation.status(sessionCookie)).toMatchObject({
      initialized: true,
      authenticated: true,
      member: { githubUserId: "101", githubLogin: "first-member" },
    });
    expect(() => observation.startOAuth({ mode: "setup", setupToken: "a".repeat(32) })).toThrowError(
      expect.objectContaining({ code: "OBSERVER_ALREADY_INITIALIZED" })
    );

    const second = await observation.addMember(sessionCookie, "https://github.com/second-member");
    expect(second).toMatchObject({ githubUserId: "202", githubLogin: "second-member" });
    observation.removeMember(sessionCookie, "101");
    expect(observation.status(sessionCookie).authenticated).toBe(false);

    exchangedIdentity = githubIdentity("202", "second-member");
    const login = observation.startOAuth({ mode: "login" });
    const loginState = new URL(login.authorizationUrl).searchParams.get("state");
    const loggedIn = await observation.finishOAuth({
      code: "code-2",
      state: loginState,
      providerError: undefined,
      cookieHeader: `${observation.oauthCookieName}=${login.cookieValue}`,
    });
    const secondCookie = `${observation.cookieName}=${loggedIn.sessionCookieValue}`;
    expect(() => observation.removeMember(secondCookie, "202")).toThrowError(
      expect.objectContaining({ code: "CONFLICT" })
    );
    expect(observation.listEvents(secondCookie).map((event) => [event.action, event.result])).toEqual([
      ["remove", "rejected"],
      ["remove", "succeeded"],
      ["add", "succeeded"],
      ["setup", "succeeded"],
    ]);
  });

  it("rejects an unknown persistent schema instead of resetting it", () => {
    const directory = mkdtempSync(join(tmpdir(), "observation-schema-"));
    directories.push(directory);
    const filename = join(directory, "observation.sqlite");
    const raw = new DatabaseSync(filename);
    raw.exec("CREATE TABLE unknown (id TEXT); PRAGMA user_version = 2;");
    raw.close();
    expect(() => new ObservationDatabase(filename)).toThrowError(
      "Unsupported Observer database version 2; expected 1."
    );
  });
});

function githubIdentity(subject: string, username: string) {
  return {
    subject,
    username,
    displayName: username,
    avatarUrl: `https://avatars.test/${subject}`,
  };
}
