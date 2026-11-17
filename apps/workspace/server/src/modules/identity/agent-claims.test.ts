import { expect, it } from "vitest";
import { createAgentClaims } from "./agent-claims.js";

const MINUTE = 60 * 1000;

function claims() {
  const clock = { at: 0 };
  const user = (id: string) => ({ id, username: id, displayName: id, avatarUrl: null });
  const service = createAgentClaims({
    identity: {
      requireSession: async (agentId) => ({ user: { ...user(agentId!), kind: "agent", claimed: false } }) as never,
      requireInteractiveSession: async () => ({ user: { ...user("human"), kind: "human" }, writeSource: "browser" }) as never,
    },
    repository: {
      findAgents: async (filter) => "userId" in filter
        ? [{ user: user(filter.userId), spaceId: "space", ownerUserId: null, lastActiveAt: 0, banned: false, files: 0 }]
        : [],
      claimAgent: async () => true,
      banClaimedAgent: async () => true,
    },
    onAgentStopped: () => {},
    now: () => clock.at,
  });
  const answer = (code: string) => service.inspect("human", code).then(() => 200, (error: { status: number }) => error.status);
  return { clock, service, answer };
}

it("answers an expired code with 410 for ten minutes and then 404, with no other agent asking for codes", async () => {
  const { clock, service, answer } = claims();
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

it("counts only unexpired codes toward the capacity", async () => {
  const { clock, service } = claims();
  for (let agent = 0; agent < 1000; agent += 1) {
    for (let copy = 0; copy < 10; copy += 1) await service.createCode(`agent-${agent}`);
  }
  await expect(service.createCode("late")).rejects.toMatchObject({ status: 503, code: "AGENT_CLAIM_UNAVAILABLE" });

  clock.at = 10 * MINUTE;
  await expect(service.createCode("late")).resolves.toMatchObject({ expiresIn: 600 });
});
