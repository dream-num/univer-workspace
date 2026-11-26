import { describe, expect, it } from "vitest";
import { openProductDatabase } from "../../server/src/db/index.js";
import { createAccessTokenService } from "../../server/src/modules/identity/access-tokens.js";
import { createIdentityModule } from "../../server/src/modules/identity/index.js";
import { createPostgresTestSchema } from "../support/postgres/schema.js";

const DAY = 24 * 60 * 60 * 1000;
const START = 1_000_000;
const PASSWORD = "correct horse battery staple";
const postgresUrl = process.env.WORKSPACE_TEST_POSTGRES_URL;
const backends = [
  {
    name: "SQLite",
    open: () => openProductDatabase({ provider: "sqlite", filename: ":memory:" }),
  },
  {
    name: "PostgreSQL",
    open: postgresUrl
      ? async () => {
          const schema = await createPostgresTestSchema(postgresUrl);
          const product = await openProductDatabase({
            provider: "postgres",
            connectionString: schema.connectionString,
          }).catch(async (error: unknown) => {
            await schema.close();
            throw error;
          });
          return {
            repositories: product.repositories,
            async close() {
              try { await product.close(); } finally { await schema.close(); }
            },
          };
        }
      : undefined,
  },
];

for (const { name, open } of backends) {
  describe.skipIf(!open)(`${name} CLI session renewal`, () => {
    it("keeps a CLI session in use working on day 8 and lets idle, browser and token sessions end", async ({ onTestFinished }) => {
      const product = await open!();
      onTestFinished(() => product.close());
      let currentTime = START;
      const now = () => currentTime;
      const identity = createIdentityModule({ repository: product.repositories.identity, sessionTtlMs: 7 * DAY, now });
      await identity.initialize();
      const authenticated = async (cookieValue: string) =>
        (await identity.getSession(`${identity.cookieName}=${cookieValue}`)).authenticated;

      const browser = await identity.registerWithPassword({ username: "renewal-user", displayName: "Renewal User", password: PASSWORD });
      const started = await identity.startCliAuthorization();
      await identity.approveCliAuthorization(`${identity.cookieName}=${browser.cookieValue}`, started.userCode);
      const approved = await identity.exchangeCliAuthorization(started.deviceCode);
      if (approved.status !== "authorized") throw new Error("Expected an approved CLI session");
      const cli = approved.issuedSession.cookieValue;
      const idleCli = (await identity.loginWithPassword({ username: "renewal-user", password: PASSWORD }, "agent")).cookieValue;
      const tokens = createAccessTokenService({ repository: product.repositories.accessTokens, now });
      const { token } = await tokens.createPersonalToken({ userId: browser.view.user.id, name: "renewal" });
      const tokenSession = await tokens.exchangeSubjectToken(token, "https://workspace.example/mcp", 10 * 60 * 1000);
      if (!tokenSession) throw new Error("Expected a token session");

      currentTime = START + 9 * 60 * 1000;
      expect(await authenticated(tokenSession.cookieValue)).toBe(true);
      currentTime = START + 11 * 60 * 1000;
      expect(await authenticated(tokenSession.cookieValue), "a token session keeps its own lifetime").toBe(false);

      currentTime = START + 4 * DAY;
      expect(await authenticated(cli)).toBe(true);
      expect(await authenticated(browser.cookieValue)).toBe(true);

      currentTime = START + 8 * DAY;
      expect(await authenticated(cli), "a CLI session used on day 4 works on day 8").toBe(true);
      expect(await authenticated(idleCli), "an idle CLI session ends with its lifetime").toBe(false);
      expect(await authenticated(browser.cookieValue), "a browser session keeps its fixed lifetime").toBe(false);

      currentTime = START + 15 * DAY + 1;
      expect(await authenticated(cli), "renewal needs use within the lifetime").toBe(false);
    });
  });
}
