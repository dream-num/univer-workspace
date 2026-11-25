import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openProductDatabase, type ProductDatabase } from "../../server/src/db/index.js";
import { createIdentityModule, createSourceRateLimiter } from "../../server/src/modules/identity/index.js";
import { createPostgresTestSchema } from "../support/postgres/schema.js";

const HOUR = 60 * 60 * 1000;

interface Backend {
  /** Opens one more product database instance on the same data, as another replica or a restart would. */
  open(): Promise<ProductDatabase>;
  close(): Promise<void>;
}

async function sqlite(): Promise<Backend> {
  const directory = mkdtempSync(join(tmpdir(), "workspace-source-rates-"));
  const opened: ProductDatabase[] = [];
  return {
    async open() {
      const product = await openProductDatabase({ provider: "sqlite", filename: join(directory, "product.sqlite") });
      opened.push(product);
      return product;
    },
    async close() {
      for (const product of opened) await product.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function postgres(url: string): Promise<Backend> {
  const schema = await createPostgresTestSchema(url);
  const opened: ProductDatabase[] = [];
  return {
    async open() {
      const product = await openProductDatabase({ provider: "postgres", connectionString: schema.connectionString });
      opened.push(product);
      return product;
    },
    async close() {
      try {
        for (const product of opened) await product.close();
      } finally {
        await schema.close();
      }
    },
  };
}

const postgresUrl = process.env.WORKSPACE_TEST_POSTGRES_URL;
const backends = [
  { name: "SQLite", start: sqlite },
  { name: "PostgreSQL", start: postgresUrl ? () => postgres(postgresUrl) : undefined },
];

for (const { name, start } of backends) {
  describe.skipIf(!start)(`${name} source rate limits`, () => {
    it("share one count between replicas, and concurrent takes admit exactly the limit", async ({ onTestFinished }) => {
      const backend = await start!();
      onTestFinished(backend.close);
      const [first, second] = [await backend.open(), await backend.open()];
      const limiters = [first, second].map((product) => createSourceRateLimiter(product.repositories.identity, "agent_create", 3, () => 0));
      const taken = await Promise.all(Array.from({ length: 12 }, (_, i) => limiters[i % 2]!.take("203.0.113.7")));
      expect(taken.filter(Boolean)).toHaveLength(3);
      expect(await Promise.all(limiters.map((limiter) => limiter.allows("203.0.113.7")))).toEqual([false, false]);
      expect(await limiters[1]!.take("203.0.113.8")).toBe(true);
      const otherAction = createSourceRateLimiter(first.repositories.identity, "email_code_check", 3, () => 0);
      expect(await otherAction.take("203.0.113.7"), "each action keeps its own count").toBe(true);
    });

    it("keep the count across a restart and slide the window one hour after each event", async ({ onTestFinished }) => {
      const backend = await start!();
      onTestFinished(backend.close);
      let now = 0;
      const limiter = async () => createSourceRateLimiter((await backend.open()).repositories.identity, "node_report", 2, () => now);
      const before = await limiter();
      expect(await before.take("203.0.113.7")).toBe(true);
      now = HOUR / 2;
      expect(await before.take("203.0.113.7")).toBe(true);
      const restarted = await limiter();
      now = HOUR - 1;
      expect(await restarted.take("203.0.113.7"), "the restart kept both events").toBe(false);
      expect(await restarted.allows("203.0.113.7")).toBe(false);
      now = HOUR;
      expect(await restarted.take("203.0.113.7")).toBe(true);
      expect(await restarted.take("203.0.113.7")).toBe(false);
      now = HOUR + HOUR / 2;
      expect(await restarted.take("203.0.113.7")).toBe(true);
    });

    it("count an IPv6 /64 as one source, IPv4-mapped IPv6 as its IPv4 host, and anything else as one shared source", async ({ onTestFinished }) => {
      const backend = await start!();
      onTestFinished(backend.close);
      const limiter = createSourceRateLimiter((await backend.open()).repositories.identity, "email_code_request", 1, () => 0);
      const take = async (...ips: (string | undefined)[]) => {
        const results = [];
        for (const ip of ips) results.push(await limiter.take(ip));
        return results;
      };
      expect(await take("2001:db8:1:2::1", "2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:0db8:0001:0002:0:0:0:9%eth0", "2001:db8:1:3::1"))
        .toEqual([true, false, false, true]);
      expect(await take("::ffff:203.0.113.7", "203.0.113.7", "::ffff:cb00:7107", "::1", "::2")).toEqual([true, false, false, true, false]);
      expect(await take(undefined, "not-an-address", "another, forged value", "198.51.100.1")).toEqual([true, false, false, true]);
    });

    it("refuse everything at a limit of 0, and record nothing when only asked", async ({ onTestFinished }) => {
      const backend = await start!();
      onTestFinished(backend.close);
      const store = (await backend.open()).repositories.identity;
      const closed = createSourceRateLimiter(store, "client_metadata_fetch", 0, () => 0);
      expect([await closed.allows("203.0.113.7"), await closed.take("203.0.113.7"), await closed.take(undefined)]).toEqual([false, false, false]);
      const open = createSourceRateLimiter(store, "client_metadata_fetch", 1, () => 0);
      expect([await open.allows("203.0.113.7"), await open.allows("203.0.113.7")]).toEqual([true, true]);
      expect([await open.take("203.0.113.7"), await open.take("203.0.113.7")]).toEqual([true, false]);
    });

    it("delete events once they are an hour old, even for a source that never returns", async ({ onTestFinished }) => {
      const backend = await start!();
      onTestFinished(backend.close);
      let now = 0;
      const store = (await backend.open()).repositories.identity;
      const limiter = createSourceRateLimiter(store, "agent_create", 5, () => now);
      for (const ip of ["203.0.113.7", "203.0.113.7", "2001:db8:1:2::1"]) await limiter.take(ip);
      expect(await store.countSourceEvents("agent_create", "203.0.113.7", -1)).toBe(2);
      now = HOUR;
      await limiter.take("198.51.100.1");
      expect(await store.countSourceEvents("agent_create", "203.0.113.7", -1)).toBe(0);
      expect(await store.countSourceEvents("agent_create", "2001:db8:1:2::/64", -1)).toBe(0);
      expect(await store.countSourceEvents("agent_create", "198.51.100.1", -1)).toBe(1);
    });

    it("refuse an agent creation past the limit on every replica and after a restart", async ({ onTestFinished }) => {
      const backend = await start!();
      onTestFinished(backend.close);
      const identity = async () => createIdentityModule({
        repository: (await backend.open()).repositories.identity,
        sessionTtlMs: 60_000,
        agentCreateLimitPerHour: 2,
        now: () => 1_000_000,
      });
      const [first, second] = [await identity(), await identity()];
      await first.createAgent({ label: "one", originIp: "203.0.113.7" });
      await second.createAgent({ label: "two", originIp: "203.0.113.7" });
      const refused = { code: "AGENT_CREATE_RATE_LIMITED", status: 429, message: "Too many agents were created from this address. Try again later." };
      await expect(first.createAgent({ label: "three", originIp: "203.0.113.7" })).rejects.toMatchObject(refused);
      await expect(second.assertAgentCreationAllowed("203.0.113.7")).rejects.toMatchObject(refused);
      const restarted = await identity();
      await expect(restarted.createAgent({ label: "four", originIp: "203.0.113.7" })).rejects.toMatchObject(refused);
      await expect(restarted.createAgent({ label: "other", originIp: "198.51.100.1" })).resolves.toHaveProperty("user.id");
    });
  });
}
