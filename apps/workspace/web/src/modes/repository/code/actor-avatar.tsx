import { Bot } from "lucide-react";
import { Avatar } from "../../../shared/ui";
import { useI18n, type MessageKey } from "../../../shared/i18n";
import type { ActorKind, ActorRef } from "../data";

export const ACTOR_LABEL = {
  people: "repositoryActorPeople",
  agents: "repositoryActorAgents",
  unknown: "repositoryActorUnknown",
} as const satisfies Record<ActorKind, MessageKey>;

export function ActorAvatar({
  actor,
  size = "md",
}: {
  readonly actor: ActorRef;
  readonly size?: "sm" | "md" | "lg";
}) {
  const { t } = useI18n();
  const name = actor.user?.displayName || actor.user?.username || t("repositoryUnknownActor");
  const label = actor.kind === "agents" ? `${name} · ${t("repositoryActorAgent")}` : name;
  return (
    <span className={`rd-avatar rd-avatar-${size}`} data-actor={actor.kind} title={label} aria-label={label}>
      {actor.kind === "agents" ? <span><Bot aria-hidden="true" /></span> : <Avatar name={name} src={actor.user?.avatarUrl} size="xs" />}
    </span>
  );
}
