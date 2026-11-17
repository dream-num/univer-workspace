import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, expect, it, vi } from "vitest";
import { logger } from "../../server/src/logging/logger.js";
import { createStaticSiteRouter } from "../../server/src/middleware/static-site.js";
import { createSqliteTestApplication, type SqliteTestApplication } from "../support/sqlite/test-application.js";

const METRICS_TOKEN = "loop-metrics-test-token";
let application: SqliteTestApplication | undefined;
let server: Server | undefined;
let directory: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  await application?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it("counts each step of the loop and keeps IDs and User-Agents out of the labels", async () => {
  const origin = await start();
  const scrape = async () =>
    (await fetch(`${origin}/metrics`, { headers: { authorization: `Bearer ${METRICS_TOKEN}` } })).text();
  const before = await scrape();
  const events = vi.spyOn(logger, "info").mockImplementation(() => undefined);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  expect((await post("/api/agents", {})).status).toBe(201);
  const guest = await post("/api/auth/guest", {});
  const cookie = guest.headers.get("set-cookie")!.split(";")[0]!;
  const agentId = ((await guest.json()) as { agent: { id: string } }).agent.id;
  const personal = (await application!.spaces.list(agentId)).spaces[0]!;
  const node = await application!.nodes.create(agentId, { spaceId: personal.id, parentNodeId: null, name: "Budget" });
  for (const enabled of [true, true, false, true]) {
    const response = await fetch(`${origin}/api/nodes/${node.id}/link-sharing`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ enabled, role: "viewer" }),
    });
    expect(response.status).toBe(200);
  }
  await fetch(`${origin}/nodes/${node.id}`, { headers: { "user-agent": "Slackbot-LinkExpanding 1.0" } });
  await fetch(`${origin}/nodes/${node.id}?view=immersive`, { headers: { cookie } });
  const register = async (username: string, returnTo?: string) => {
    const referer = returnTo === undefined ? {} : { referer: `${origin}/login?mode=register&returnTo=${encodeURIComponent(returnTo)}` };
    const response = await post("/api/auth/password/register", { username, displayName: username, password: "correct horse battery staple" }, referer);
    expect(response.status).toBe(201);
    return ((await response.json()) as { user: { id: string } }).user.id;
  };
  const reader = await register("reader", `/nodes/${node.id}?view=immersive`);
  await register("consenting", "/api/auth/authorize/consent?client_id=cli");
  await register("direct");

  const after = await scrape();
  const added = (series: string) => value(after, series) - value(before, series);
  expect({
    agentsFromApi: added('workspace_guest_agents_created_total{entry="api_agents"}'),
    agentsFromGuestCard: added('workspace_guest_agents_created_total{entry="auth_guest"}'),
    sharingOn: added('workspace_link_sharing_changes_total{state="on",role="viewer",owner_category="agent_unclaimed"}'),
    sharingOff: added('workspace_link_sharing_changes_total{state="off",role="viewer",owner_category="agent_unclaimed"}'),
    pagesSignedOut: added('workspace_share_page_views_total{session="signed_out",owner_category="agent_unclaimed"}'),
    pagesSignedIn: added('workspace_share_page_views_total{session="signed_in",owner_category="agent_unclaimed"}'),
    signupsFromShareLink: added('workspace_signups_total{method="password",source="share_link"}'),
    signupsFromConsent: added('workspace_signups_total{method="password",source="oauth_consent"}'),
    signupsDirect: added('workspace_signups_total{method="password",source="direct"}'),
    emailSignups: value(after, 'workspace_signups_total{method="email",source="share_link"}'),
  }).toEqual({
    agentsFromApi: 1,
    agentsFromGuestCard: 1,
    sharingOn: 2,
    sharingOff: 1,
    pagesSignedOut: 1,
    pagesSignedIn: 1,
    signupsFromShareLink: 1,
    signupsFromConsent: 1,
    signupsDirect: 1,
    emailSignups: 0,
  });
  for (const identifying of [node.id, agentId, reader, "Slackbot"]) expect(after).not.toContain(identifying);

  const logged = events.mock.calls.map(([line]) => line as Record<string, unknown>)
    .filter((line) => typeof line.event === "string" && line.event.startsWith("workspace."));
  expect(logged).toContainEqual(expect.objectContaining({
    event: "workspace.share_page", schema_version: 1, session: "signed_out", node_id: node.id, user_agent: "Slackbot-LinkExpanding 1.0",
  }));
  expect(logged).toContainEqual(expect.objectContaining({
    event: "workspace.signup", source: "share_link", user_id: reader, node_id: node.id,
  }));
  expect(logged).toContainEqual(expect.objectContaining({
    event: "workspace.link_sharing", state: "off", node_id: node.id, user_id: agentId,
  }));
  expect(logged.filter((line) => line.event === "workspace.guest_agent")).toHaveLength(2);
});

function value(metrics: string, series: string): number {
  const line = metrics.split("\n").find((candidate) => candidate.startsWith(`${series} `));
  if (line === undefined) throw new Error(`${series} is not exported`);
  return Number(line.slice(series.length + 1));
}

async function start(): Promise<string> {
  application = await createSqliteTestApplication({
    host: "127.0.0.1",
    port: 0,
    database: { provider: "sqlite", filename: ":memory:", collaborationFilename: ":memory:" },
    secureCookies: false,
    sessionTtlMs: 24 * 60 * 60_000,
    passwordAuthEnabled: true,
    emailAuth: null,
    metricsToken: METRICS_TOKEN,
  }, {
    unitStore: { createUnit: async (input) => ({ unitId: input.unitId, headRevision: 1 }) },
  });
  directory = mkdtempSync(join(tmpdir(), "workspace-loop-metrics-"));
  writeFileSync(join(directory, "index.html"), "<!doctype html><html><head><title>Univer Workspace</title></head><body></body></html>");
  const app = express();
  // The production build mounts share pages after the API when the web bundle exists.
  app.get("/nodes/:nodeId", createStaticSiteRouter(directory, application));
  app.use(application.app);
  const listening = createServer(app);
  server = listening;
  await new Promise<void>((resolve) => listening.listen(0, "127.0.0.1", resolve));
  const address = listening.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return `http://127.0.0.1:${address.port}`;
}
