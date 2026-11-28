import type { components } from "../../../../generated/http/schema.js";
import { validLoginReturnTo } from "../auth/auth.queries";

type AgentSummary = components["schemas"]["AgentSummary"];
type MySpace = components["schemas"]["MySpaceView"];

export function validClaimTarget(value: unknown): string | undefined {
  const valid = validLoginReturnTo(value);
  if (!valid) return undefined;
  return valid.startsWith("/nodes/") || valid.startsWith("/spaces/") ? valid : undefined;
}

/** Where a person lands after claiming an agent: the one place that holds its work, or a list of its repositories. */
export function claimLanding(agent: AgentSummary, mySpaces: readonly MySpace[]) {
  const places = [
    ...(agent.files > 0 ? [agent.spaceId] : []),
    ...mySpaces.filter((space) => space.type === "team" && space.owner.id === agent.id).map(({ id }) => id),
  ];
  // Spaces carry no activity time, so with work in several of them none can be named the most recent.
  return places.length > 1
    ? ({ to: "/repositories", search: { q: agent.username } } as const)
    : ({ to: "/spaces/$spaceId", params: { spaceId: places[0] ?? agent.spaceId }, search: {} } as const);
}
