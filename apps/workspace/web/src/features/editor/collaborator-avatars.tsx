import type { IMember } from "@univerjs/protocol";
import { useI18n } from "../../shared/i18n";
import { Avatar, Tooltip } from "../../shared/ui";
import { uniqueCollaborators } from "./collaborator-members";

const VISIBLE_MEMBERS = 4;
const MEMBER_ACCENTS = [
  "bg-blue-500",
  "bg-amber-500",
  "bg-teal-600",
  "bg-green-600",
] as const;

export function CollaboratorAvatars({
  members,
  currentUserId,
}: {
  readonly members: readonly IMember[];
  readonly currentUserId: string;
}) {
  const { t } = useI18n();
  const users = uniqueCollaborators(members, currentUserId);
  if (users.length === 0) return null;
  const memberLabel = (member: IMember) =>
    member.userID === currentUserId
      ? t("collaboratorYou", { name: member.name || member.userID })
      : member.name || member.userID;
  const overflow = users.slice(VISIBLE_MEMBERS);
  const onlineLabel = t("collaboratorsOnline", { count: users.length });

  return (
    <div
      role="group"
      aria-label={onlineLabel}
      className="flex shrink-0 items-center px-1"
    >
      <div className="flex items-center gap-2 sm:gap-3">
        {users.slice(0, VISIBLE_MEMBERS).map((member, index) => (
          <Tooltip key={member.userID} content={memberLabel(member)}>
            <span
              tabIndex={0}
              aria-label={memberLabel(member)}
              className="relative inline-flex rounded-full outline-offset-4 transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Avatar
                src={member.avatar}
                name={member.name}
                className="size-7 sm:size-9"
              />
              <span
                aria-hidden="true"
                className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-background sm:size-3 ${MEMBER_ACCENTS[index]}`}
              />
            </span>
          </Tooltip>
        ))}
        {overflow.length > 0 ? (
          <Tooltip
            content={
              <ul className="max-h-48 overflow-y-auto">
                {overflow.map((member) => (
                  <li key={member.userID}>{memberLabel(member)}</li>
                ))}
              </ul>
            }
          >
            <span
              tabIndex={0}
              aria-label={overflow.map(memberLabel).join(", ")}
              className="grid size-7 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring sm:size-9 sm:text-sm"
            >
              +{overflow.length}
            </span>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
