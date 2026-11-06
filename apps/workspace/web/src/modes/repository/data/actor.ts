import type { ActorKind, ActorRef, Segment, WireWriteSource } from "./types";

export const ACTOR_KINDS = ["people", "agents", "unknown"] as const satisfies readonly ActorKind[];

const KIND_OF: Readonly<Record<WireWriteSource, ActorKind>> = {
  browser: "people",
  agent: "agents",
  unknown: "unknown",
};

export function actorOf(user: ActorRef["user"], source: WireWriteSource): ActorRef {
  return { user, kind: KIND_OF[source] };
}

export function tally(sources: Iterable<WireWriteSource>): Record<ActorKind, number> {
  const counts = { people: 0, agents: 0, unknown: 0 };
  for (const source of sources) counts[KIND_OF[source]] += 1;
  return counts;
}

export function kindCounts(counts: Readonly<Record<WireWriteSource, number>>): Record<ActorKind, number> {
  const result = { people: 0, agents: 0, unknown: 0 };
  for (const source of ["browser", "agent", "unknown"] as const) result[KIND_OF[source]] = counts[source];
  return result;
}

export function segmentsOf(counts: Readonly<Record<ActorKind, number>>): Segment[] {
  return ACTOR_KINDS.filter((kind) => kind !== "unknown" || counts.unknown > 0)
    .map((key) => ({ key, value: counts[key] }));
}
