import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, expect, it, vi } from "vitest";
import type { EmailMessage } from "../../server/src/integrations/email/index.js";
import { logger } from "../../server/src/logging/logger.js";
import { createStaticSiteRouter } from "../../server/src/middleware/static-site.js";
import { createSqliteTestApplication, type SqliteTestApplication } from "../support/sqlite/test-application.js";

const METRICS_TOKEN = "loop-metrics-test-token";
let application: SqliteTestApplication | undefined;
let server: Server | undefined;
let directory: string | undefined;
const emails: EmailMessage[] = [];
let oauthUsers = 0;

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
  const share = async (enabled: boolean, role = "viewer") => {
    const response = await fetch(`${origin}/api/nodes/${node.id}/link-sharing`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ enabled, role }),
    });
    expect(response.status).toBe(200);
  };
  // Hold both writes until both requests reach the store, so two concurrent enables race for real.
  const repository = application!.repositories.permissions;
  const upsert = repository.upsertLinkSharing.bind(repository);
  let arrived = 0;
  let release!: () => void;
  const bothArrived = new Promise<void>((resolve) => (release = resolve));
  vi.spyOn(repository, "upsertLinkSharing").mockImplementation(async (input) => {
    if (++arrived === 2) release();
    await bothArrived;
    return await upsert(input);
  });
  await Promise.all([share(true), share(true)]);
  vi.mocked(repository.upsertLinkSharing).mockRestore();
  await share(false);
  await share(true);
  await share(true, "editor");
  const page = await fetch(`${origin}/nodes/${node.id}`, { headers: { "user-agent": "Slackbot-LinkExpanding 1.0" } });
  // A browser reload; without an explicit Cache-Control, fetch adds no-cache and the server never answers 304.
  const revalidated = await fetch(`${origin}/nodes/${node.id}`, {
    headers: { "if-none-match": page.headers.get("etag")!, "cache-control": "max-age=0" },
  });
  expect(revalidated.status).toBe(304);
  expect((await fetch(`${origin}/nodes/${node.id}`, { method: "HEAD" })).status).toBe(200);
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
  const claimPage = `${origin}/claim/c0de-in-path`;
  const claimer = await post("/api/auth/password/register", { username: "claimer", displayName: "claimer", password: "correct horse battery staple" }, { referer: claimPage });
  expect(claimer.status).toBe(201);
  for (const [username, referer] of [["sharepage", `${origin}/nodes/${node.id}`], ["dotdot", `${origin}/claim/../nodes/${node.id}`]]) {
    expect((await post("/api/auth/password/register", { username, displayName: username, password: "correct horse battery staple" }, { referer })).status).toBe(201);
  }
  const emailSignup = async (email: string, referer?: string) => {
    expect((await post("/api/auth/email/code", { email })).status).toBe(202);
    const code = /\b(\d{6})\b/u.exec(emails.at(-1)!.text)![1]!;
    expect((await post("/api/auth/email/login", { email, code }, referer === undefined ? {} : { referer })).status).toBe(200);
  };
  await emailSignup("shared@example.com", `${origin}/login?returnTo=${encodeURIComponent(`/nodes/${node.id}`)}`);
  await emailSignup("direct@example.com");
  await emailSignup("claimer@example.com", claimPage);
  const oauthSignup = async (returnTo: string) => {
    const started = await fetch(`${origin}/api/auth/github/login?returnTo=${encodeURIComponent(returnTo)}`, { redirect: "manual" });
    const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
    const finished = await fetch(`${origin}/api/auth/github/callback?code=code&state=${encodeURIComponent(state)}`, {
      redirect: "manual",
      headers: { cookie: started.headers.get("set-cookie")!.split(";")[0]! },
    });
    expect(finished.headers.get("location")).toBe(returnTo);
  };
  await oauthSignup(`/nodes/${node.id}`);
  await oauthSignup("/api/auth/authorize?client_id=cli");
  await oauthSignup("/claim/c0de-in-path");

  // Share pages are counted beside the response, so wait for the counts to land.
  const after = await vi.waitFor(async () => {
    const metrics = await scrape();
    const views = (session: string) => {
      const series = `workspace_share_page_views_total{session="${session}",owner_category="agent_unclaimed"}`;
      return value(metrics, series) - value(before, series);
    };
    expect({ signedOut: views("signed_out"), signedIn: views("signed_in") }).toEqual({ signedOut: 2, signedIn: 1 });
    return metrics;
  });
  const added = (series: string) => value(after, series) - value(before, series);
  expect({
    agentsFromApi: added('workspace_guest_agents_created_total{entry="api_agents"}'),
    agentsFromGuestCard: added('workspace_guest_agents_created_total{entry="auth_guest"}'),
    sharingOn: added('workspace_link_sharing_changes_total{state="on",role="viewer",owner_category="agent_unclaimed"}'),
    sharingOnByRoleChange: added('workspace_link_sharing_changes_total{state="on",role="editor",owner_category="agent_unclaimed"}'),
    sharingOff: added('workspace_link_sharing_changes_total{state="off",role="viewer",owner_category="agent_unclaimed"}'),
    signupsFromShareLink: added('workspace_signups_total{method="password",source="share_link"}'),
    signupsFromConsent: added('workspace_signups_total{method="password",source="oauth_consent"}'),
    signupsDirect: added('workspace_signups_total{method="password",source="direct"}'),
    signupsFromClaimLink: added('workspace_signups_total{method="password",source="claim_link"}'),
    emailFromShareLink: added('workspace_signups_total{method="email",source="share_link"}'),
    emailDirect: added('workspace_signups_total{method="email",source="direct"}'),
    emailFromClaimLink: added('workspace_signups_total{method="email",source="claim_link"}'),
    oauthFromShareLink: added('workspace_signups_total{method="github",source="share_link"}'),
    oauthFromConsent: added('workspace_signups_total{method="github",source="oauth_consent"}'),
    oauthFromClaimLink: added('workspace_signups_total{method="github",source="claim_link"}'),
  }).toEqual({
    agentsFromApi: 1,
    agentsFromGuestCard: 1,
    sharingOn: 2,
    sharingOnByRoleChange: 0,
    sharingOff: 1,
    signupsFromShareLink: 1,
    signupsFromConsent: 1,
    signupsDirect: 3,
    signupsFromClaimLink: 1,
    emailFromShareLink: 1,
    emailDirect: 1,
    emailFromClaimLink: 1,
    oauthFromShareLink: 1,
    oauthFromConsent: 1,
    oauthFromClaimLink: 1,
  });
  for (const identifying of [node.id, agentId, reader, "Slackbot", "c0de-in-path"]) expect(after).not.toContain(identifying);

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
  const claimSignups = logged.filter((line) => line.event === "workspace.signup" && line.source === "claim_link");
  expect(claimSignups).toHaveLength(3);
  expect(claimSignups.every((line) => line.node_id === null)).toBe(true);
  expect(JSON.stringify(logged)).not.toContain("c0de-in-path");
});

it("counts a ceiling denial by action, code and the category of the principal it stopped", async () => {
  const origin = await start();
  const guest = await fetch(`${origin}/api/auth/guest`, { method: "POST" });
  const cookie = guest.headers.get("set-cookie")!.split(";")[0]!;
  const refused = await fetch(`${origin}/api/team-spaces`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Agent team" }),
  });
  expect(refused.status).toBe(403);

  const metrics = await (await fetch(`${origin}/metrics`, { headers: { authorization: `Bearer ${METRICS_TOKEN}` } })).text();
  const denials = (category: string) =>
    value(metrics, `workspace_ceiling_denials_total{action="createTeamSpace",code="AGENT_NOT_ALLOWED",principal_category="${category}"}`);
  expect({ unclaimed: denials("agent_unclaimed"), human: denials("human") }).toEqual({ unclaimed: 1, human: 0 });
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
    emailSender: { send: async (message) => void emails.push(message) },
    githubOAuthProvider: {
      authorizationUrl: ({ state }) => `https://github.example/authorize?state=${state}`,
      exchangeCode: async () => {
        oauthUsers += 1;
        return { subject: `github-${oauthUsers}`, username: `github${oauthUsers}`, displayName: "GitHub", avatarUrl: null };
      },
    },
    oauthStateSecret: "loop-metrics-oauth-state-secret",
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
