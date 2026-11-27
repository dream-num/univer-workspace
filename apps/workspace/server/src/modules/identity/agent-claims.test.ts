import { expect, it, onTestFinished, vi } from "vitest";
import { SqliteDatabase } from "../../db/sqlite/connection.js";
import { SqliteIdentityRepository } from "../../db/sqlite/identity/identity.repository.js";
import { ApplicationError } from "../../middleware/errors.js";
import { createAgentClaims } from "./agent-claims.js";

const DAY = 24 * 60 * 60 * 1000;

function claims() {
  const clock = { at: 0 };
  const owners = new Map<string, string>();
  const user = (id: string) => ({ id, username: id, displayName: id, avatarUrl: null });
  const database = new SqliteDatabase(":memory:");
  onTestFinished(() => database.close());
  const codes = new SqliteIdentityRepository(database);
  const touchAgent = vi.fn(async () => {});
  const onAgentClaimed = vi.fn();
  const keepFileLinks = vi.fn(async (_human: { readonly user: { readonly id: string } }, _agentUserId: string) => {});
  const service = createAgentClaims({
    identity: {
      requireSession: async (agentId) => ({ user: { ...user(agentId!), kind: "agent", claimed: false } }) as never,
      requireInteractiveSession: async (humanId) => {
        if (!humanId) throw new ApplicationError("UNAUTHENTICATED", 401, "Authentication is required.");
        return { user: { ...user(humanId), kind: "human" } } as never;
      },
    },
    repository: {
      findAgents: async (filter) => "userId" in filter
        ? [{ user: user(filter.userId), spaceId: "space", ownerUserId: owners.get(filter.userId) ?? null, originLabel: "agent", lastActiveAt: 0, banned: false, files: 0 }]
        : [],
      listAgentSpaces: async () => [{ id: "space", type: "personal", name: "Personal", files: 0 }],
      touchAgent,
      claimAgent: async (agentId, humanId) => !owners.has(agentId) && Boolean(owners.set(agentId, humanId)),
      banClaimedAgent: async () => true,
      putSignInCode: (code, limits) => codes.putSignInCode(code, limits),
      findSignInCode: (kind, hash) => codes.findSignInCode(kind, hash),
    },
    keepFileLinks,
    onAgentClaimed,
    onAgentStopped: () => {},
    now: () => clock.at,
  });
  const answer = (code: string) => service.handoff(undefined, code).then(() => 200, (error: { status: number }) => error.status);
  return { clock, service, answer, touchAgent, onAgentClaimed, keepFileLinks, database };
}

it("answers a signed-out visitor for seven days, an expired code with 410 for seven more, and then 404", async () => {
  const { clock, service, answer } = claims();
  const { code, expiresIn } = await service.createCode("agent");
  expect(expiresIn).toBe(7 * 24 * 60 * 60);

  clock.at = 7 * DAY - 1;
  expect(await answer(code)).toBe(200);
  clock.at = 7 * DAY;
  expect(await answer(code)).toBe(410);
  clock.at = 14 * DAY - 1;
  expect(await answer(code)).toBe(410);
  clock.at = 14 * DAY;
  expect(await answer(code)).toBe(404);
});

it("lets the browser keep a live code for what is left of it, renews the agent, and stops both once a person takes it", async () => {
  const { clock, service, touchAgent, onAgentClaimed } = claims();
  const { code } = await service.createCode("agent");
  clock.at = DAY;

  await expect(service.handoff(undefined, code)).resolves.toMatchObject({
    view: { claimed: false, agent: { id: "agent" }, expiresAt: new Date(7 * DAY).toISOString(), spaces: [{ id: "space" }] },
    previewMs: 6 * DAY,
  });
  expect(touchAgent).toHaveBeenCalledTimes(1);
  await expect(service.handoff("alice", code)).resolves.toMatchObject({ view: { claimed: false }, previewMs: 6 * DAY });
  expect(touchAgent).toHaveBeenCalledTimes(2);

  await service.claim("alice", code, false);
  await service.claim("alice", code, false);
  expect(onAgentClaimed).toHaveBeenCalledTimes(1);
  await expect(service.handoff("alice", code)).resolves.toMatchObject({ view: { claimed: true }, previewMs: null });
  await expect(service.handoff(undefined, code)).rejects.toMatchObject({ status: 409, code: "AGENT_ALREADY_CLAIMED" });
  await expect(service.handoff("bob", code)).rejects.toMatchObject({ status: 409 });
  await expect(service.claim("bob", code, true)).rejects.toMatchObject({ status: 409 });
  expect(touchAgent).toHaveBeenCalledTimes(2);
});

it("keeps the file links after the claim is stored, and finishes on a retry when that step failed", async () => {
  const { service, keepFileLinks, onAgentClaimed } = claims();
  const { code } = await service.createCode("agent");

  keepFileLinks.mockRejectedValueOnce(new Error("database is down"));
  await expect(service.claim("alice", code, true)).rejects.toThrow("database is down");
  expect(onAgentClaimed).toHaveBeenCalledTimes(1);
  await expect(service.handoff("alice", code)).resolves.toMatchObject({ view: { claimed: true } });

  await service.claim("alice", code, true);
  expect(keepFileLinks).toHaveBeenCalledTimes(2);
  expect(keepFileLinks).toHaveBeenLastCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: "alice" }) }), "agent");
  await service.claim("alice", code, false);
  expect(keepFileLinks).toHaveBeenCalledTimes(2);
  expect(onAgentClaimed).toHaveBeenCalledTimes(1);
});

it("counts only unexpired codes toward the capacity of 100,000", async () => {
  const { clock, service, database } = claims();
  database.connection.exec(`
    WITH RECURSIVE filler(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM filler WHERE n < 100000)
    INSERT INTO sign_in_codes (kind, code_hash, subject_user_id, payload_json, created_at, expires_at)
    SELECT 'claim', 'filler-' || n, 'agent-' || n, '{}', 0, 1000 FROM filler`);
  await expect(service.createCode("late")).rejects.toMatchObject({ status: 503, code: "AGENT_CLAIM_UNAVAILABLE" });

  clock.at = 1000;
  await expect(service.createCode("late")).resolves.toMatchObject({ claimUrl: expect.stringMatching(/^\/claim\//u) });
});

it("keeps an agent's ten newest codes and answers the one before them as unknown", async () => {
  const { clock, service, answer } = claims();
  const codes: string[] = [];
  for (let minute = 0; minute < 11; minute += 1) {
    clock.at = minute;
    codes.push((await service.createCode("agent")).code);
  }
  const other = (await service.createCode("other")).code;
  expect(await Promise.all([...codes, other].map(answer))).toEqual([404, ...Array<number>(11).fill(200)]);
});
