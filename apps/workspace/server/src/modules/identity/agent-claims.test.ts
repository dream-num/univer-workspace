import { expect, it, onTestFinished } from "vitest";
import { openProductDatabase } from "../../db/index.js";
import { createAgentClaims } from "./agent-claims.js";

const MINUTE = 60 * 1000;

async function claims() {
  const clock = { at: 0 };
  const user = (id: string) => ({ id, username: id, displayName: id, avatarUrl: null });
  const product = await openProductDatabase({ provider: "sqlite", filename: ":memory:" });
  onTestFinished(() => product.close());
  const codes = product.repositories.identity;
  const service = createAgentClaims({
    identity: {
      requireSession: async (agentId) => ({ user: { ...user(agentId!), kind: "agent", claimed: false } }) as never,
      requireInteractiveSession: async () => ({ user: { ...user("human"), kind: "human" } }) as never,
    },
    repository: {
      findAgents: async (filter) => "userId" in filter
        ? [{ user: user(filter.userId), spaceId: "space", ownerUserId: null, originLabel: "agent", lastActiveAt: 0, banned: false, files: 0 }]
        : [],
      claimAgent: async () => true,
      banClaimedAgent: async () => true,
      putSignInCode: (code, limits) => codes.putSignInCode(code, limits),
      findSignInCode: (kind, hash) => codes.findSignInCode(kind, hash),
    },
    onAgentStopped: () => {},
    now: () => clock.at,
  });
  const answer = (code: string) => service.inspect("human", code).then(() => 200, (error: { status: number }) => error.status);
  return { clock, service, answer };
}

it("answers an expired code with 410 for ten minutes and then 404, with no other agent asking for codes", async () => {
  const { clock, service, answer } = await claims();
  const { code } = await service.createCode("agent");

  clock.at = 10 * MINUTE - 1;
  expect(await answer(code)).toBe(200);
  clock.at = 10 * MINUTE;
  expect(await answer(code)).toBe(410);
  clock.at = 20 * MINUTE - 1;
  expect(await answer(code)).toBe(410);
  clock.at = 20 * MINUTE;
  expect(await answer(code)).toBe(404);
});

it("counts only unexpired codes toward the capacity", { timeout: 60_000 }, async () => {
  const { clock, service } = await claims();
  for (let agent = 0; agent < 1000; agent += 1) {
    for (let copy = 0; copy < 10; copy += 1) await service.createCode(`agent-${agent}`);
  }
  await expect(service.createCode("late")).rejects.toMatchObject({ status: 503, code: "AGENT_CLAIM_UNAVAILABLE" });

  clock.at = 10 * MINUTE;
  await expect(service.createCode("late")).resolves.toMatchObject({ expiresIn: 600 });
});

it("keeps an agent's ten newest codes and answers the one before them as unknown", async () => {
  const { clock, service, answer } = await claims();
  const codes: string[] = [];
  for (let minute = 0; minute < 11; minute += 1) {
    clock.at = minute;
    codes.push((await service.createCode("agent")).code);
  }
  const other = (await service.createCode("other")).code;
  expect(await Promise.all([...codes, other].map(answer))).toEqual([404, ...Array<number>(11).fill(200)]);
});
