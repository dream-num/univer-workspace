import type { ActorRef } from "./types";

export function actorOf(user: ActorRef["user"]): ActorRef {
  return { user, source: "unknown" };
}
