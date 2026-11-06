import { Avatar } from "../../../shared/ui";
import { useI18n } from "../../../shared/i18n";
import type { ActorRef } from "../data";

export function ActorAvatar({
  actor,
  size = "md",
}: {
  readonly actor: ActorRef;
  readonly size?: "sm" | "md" | "lg";
}) {
  const { t } = useI18n();
  const name = actor.user?.displayName || actor.user?.username || t("repositoryUnknownActor");
  return (
    <span className={`rd-avatar rd-avatar-${size}`} title={name} aria-label={name}>
      <Avatar name={name} src={actor.user?.avatarUrl} size="xs" />
    </span>
  );
}
