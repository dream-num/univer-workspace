import client from "prom-client";
import { expect, it } from "vitest";
import { exposureGuard, type ExposureChange } from "../server/src/modules/access/index.js";
import type { Principal } from "../server/src/modules/identity/index.js";
import { parseConfirmRequest } from "../web/src/features/confirm/confirm-request.js";

const claimedAgent: Principal = {
  user: { id: "agent", username: "agent", displayName: "Agent", avatarUrl: null, kind: "agent", claimed: true },
  writeSource: "agent",
  tokenIssued: true,
};

const changes: readonly ExposureChange[] = [
  { kind: "public", spaceId: "space 1&x=y" },
  { kind: "member", spaceId: "space-1", userId: "user/2?", role: "admin" },
  { kind: "member", spaceId: "space-1", userId: "42", role: "viewer" },
  { kind: "grant", nodeId: "node#3", userId: "user-2", role: "editor" },
  { kind: "grant", nodeId: "node-3", userId: "user-2", role: "viewer" },
  { kind: "link-sharing", nodeId: "node-3", role: "editor" },
  { kind: "link-sharing", nodeId: "node-3", role: "viewer" },
];

function refusedUrl(change: ExposureChange): string | undefined {
  try {
    (exposureGuard(claimedAgent, change) as (before: null) => void)(null);
  } catch (error) {
    return (error as { url?: string }).url;
  }
  throw new Error(`${change.kind} was not refused`);
}

it("covers every change the server refuses with a link", async () => {
  const counted = await client.register.getSingleMetric("workspace_exposure_refusals_total")!.get();
  const kinds = new Set(counted.values.map((value) => value.labels.change));
  expect(refusedUrl({ kind: "create-public" }), "creating public has no Space to confirm").toBeUndefined();
  kinds.delete("create-public");
  expect(new Set(changes.map((change) => change.kind))).toEqual(kinds);
});

it.each(changes)("the confirm page reads back the $kind $role link the server made", (change) => {
  const url = new URL(refusedUrl(change)!, "https://workspace.example");
  const { kind, ...target } = change;
  expect(url.pathname).toBe(`/confirm/${kind}`);
  expect(parseConfirmRequest(kind, url.searchParams)).toEqual({ action: kind, ...target });
});
