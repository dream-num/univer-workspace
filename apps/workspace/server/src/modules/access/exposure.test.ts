import client from "prom-client";
import { expect, it } from "vitest";
import type { Principal } from "../identity/index.js";
import { exposureGuard, type ExposureChange } from "./exposure.js";

const session = (kind: "human" | "agent", writeSource: Principal["writeSource"], tokenIssued: boolean, claimed = true): Principal => ({
  user: { id: "actor", username: "actor", displayName: "Actor", avatarUrl: null, ...(kind === "human" ? { kind } : { kind, claimed }) },
  writeSource,
  tokenIssued,
});

const browserPerson = session("human", "browser", false);
const refusedWithLink = {
  "a person's CLI session": session("human", "agent", false),
  "a person's token session": session("human", "agent", true),
  "a person's browser session a token issued": session("human", "browser", true),
  "a claimed agent": session("agent", "agent", true),
};
const unclaimedAgent = session("agent", "agent", true, false);

/** Each confirmable change with the stored levels it widens, repeats and narrows, and its confirm link. */
const cases = [
  { change: { kind: "public", spaceId: "s 1" }, widens: [null], keeps: ["public"], url: "/confirm/public?space=s+1" },
  {
    change: { kind: "member", spaceId: "s1", userId: "u&2", role: "editor" },
    widens: [null, "viewer"], keeps: ["editor", "admin"], url: "/confirm/member?space=s1&user=u%262&role=editor",
  },
  {
    change: { kind: "member", spaceId: "s1", userId: "u2", role: "admin" },
    widens: [null, "viewer", "editor"], keeps: ["admin"], url: "/confirm/member?space=s1&user=u2&role=admin",
  },
  {
    change: { kind: "grant", nodeId: "n1", userId: "u2", role: "editor" },
    widens: [null, "viewer"], keeps: ["editor"], url: "/confirm/grant?node=n1&user=u2&role=editor",
  },
  {
    change: { kind: "grant", nodeId: "n1", userId: "u2", role: "viewer" },
    widens: [null], keeps: ["viewer", "editor"], url: "/confirm/grant?node=n1&user=u2&role=viewer",
  },
  {
    change: { kind: "link-sharing", nodeId: "n1", role: "editor" },
    widens: [null, "viewer"], keeps: ["editor"], url: "/confirm/link-sharing?node=n1&role=editor",
  },
] as const satisfies readonly { change: ExposureChange; widens: readonly unknown[]; keeps: readonly unknown[]; url: string }[];

const guard = (actor: Principal, change: ExposureChange | null) => exposureGuard(actor, change) as (before: string | null) => void;

it("lets only a person in a browser widen, and refuses every other owned session with the change's confirm link", () => {
  for (const { change, widens, keeps, url } of cases) {
    for (const before of widens) {
      expect(() => guard(browserPerson, change)(before), `${change.kind} from ${before}`).not.toThrow();
      for (const [name, actor] of Object.entries(refusedWithLink)) {
        expect(() => guard(actor, change)(before), `${name}: ${change.kind} from ${before}`)
          .toThrow(expect.objectContaining({ code: "INTERACTIVE_SESSION_REQUIRED", status: 403, url }));
      }
    }
    for (const before of keeps) {
      for (const [name, actor] of Object.entries({ ...refusedWithLink, "an unclaimed agent": unclaimedAgent })) {
        expect(() => guard(actor, change)(before), `${name}: ${change.kind} from ${before}`).not.toThrow();
      }
    }
  }
});

it("passes a write that cannot widen for every session, whatever is stored", () => {
  for (const actor of [...Object.values(refusedWithLink), unclaimedAgent]) {
    for (const before of [null, "public", "viewer", "admin"]) expect(() => guard(actor, null)(before)).not.toThrow();
  }
});

it("tells an unclaimed agent to hand over a claim link, with no confirm link, except for a viewer link", () => {
  for (const { change, widens } of cases) {
    for (const before of widens) {
      const refusal = (() => { try { guard(unclaimedAgent, change)(before); } catch (error) { return error; } })();
      expect(refusal, `${change.kind} from ${before}`).toMatchObject({ code: "AGENT_NOT_ALLOWED", status: 403 });
      expect(refusal).not.toHaveProperty("url", expect.anything());
      expect((refusal as Error).message).toContain("claim link");
    }
  }
  const viewerLink = { kind: "link-sharing", nodeId: "n1", role: "viewer" } as const;
  expect(() => guard(unclaimedAgent, viewerLink)(null)).not.toThrow();
  expect(() => guard(refusedWithLink["a claimed agent"], viewerLink)(null))
    .toThrow(expect.objectContaining({ code: "INTERACTIVE_SESSION_REQUIRED", url: "/confirm/link-sharing?node=n1&role=viewer" }));
});

it("refuses creating a public repository without a link, because no repository exists to confirm", () => {
  const create = { kind: "create-public" } as const;
  expect(() => guard(browserPerson, create)(null)).not.toThrow();
  const refusal = (() => { try { guard(refusedWithLink["a claimed agent"], create)(null); } catch (error) { return error; } })();
  expect(refusal).toMatchObject({ code: "INTERACTIVE_SESSION_REQUIRED", status: 403 });
  expect(refusal).not.toHaveProperty("url", expect.anything());
  expect(() => guard(unclaimedAgent, create)(null)).toThrow(expect.objectContaining({ code: "AGENT_NOT_ALLOWED" }));
});

it("counts a refusal once, by change, code and principal category, and counts nothing that passes", async () => {
  const count = async (labels: Record<string, string>) => {
    const metric = await client.register.getSingleMetric("workspace_exposure_refusals_total")!.get();
    return metric.values.find((value) => Object.entries(labels).every(([key, label]) => value.labels[key] === label))?.value;
  };
  const claimed = { change: "member", code: "INTERACTIVE_SESSION_REQUIRED", principal_category: "agent_claimed" };
  const unclaimed = { change: "public", code: "AGENT_NOT_ALLOWED", principal_category: "agent_unclaimed" };
  const before = [await count(claimed), await count(unclaimed)];
  expect(before.every((value) => value !== undefined), "every series starts at zero").toBe(true);

  const member = { kind: "member", spaceId: "s1", userId: "u2", role: "editor" } as const;
  expect(() => guard(refusedWithLink["a claimed agent"], member)(null)).toThrow();
  guard(refusedWithLink["a claimed agent"], member)("editor");
  guard(browserPerson, member)(null);
  expect(() => guard(unclaimedAgent, { kind: "public", spaceId: "s1" })(null)).toThrow();
  expect([await count(claimed), await count(unclaimed)]).toEqual([before[0]! + 1, before[1]! + 1]);
});
