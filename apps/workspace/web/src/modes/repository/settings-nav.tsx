import { Settings, Trash2, Users } from "lucide-react";
import { CurrentLink } from "./current-link";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "../../shared/i18n";
import { spaceQueryOptions } from "../../features/spaces/spaces.queries";
import { spaceSupportsMembers } from "../../features/spaces/space.rules";

export type SpaceSettingsSection = "general" | "members" | "trash";

/**
 * Settings navigation for a repository. The mode renders it
 * next to the space settings pages; sections the current User cannot manage are
 * hidden instead of being disabled.
 */
export function SpaceSettingsNav({
  spaceId,
  current,
}: {
  readonly spaceId: string;
  readonly current: SpaceSettingsSection;
}) {
  const { t } = useI18n();
  const spaces = useQuery(spaceQueryOptions(spaceId));
  const space = spaces.data;
  const canManageMembers =
    space !== undefined && spaceSupportsMembers(space) && space.capabilities.manageMembers;
  const canViewTrash = space?.capabilities.viewTrash ?? false;
  const items: readonly {
    readonly section: SpaceSettingsSection;
    readonly label: string;
    readonly icon: typeof Settings;
    readonly group?: string;
  }[] = [
    { section: "general", label: t("settingsGeneral"), icon: Settings },
    ...(canManageMembers
      ? [
          {
            section: "members" as const,
            label: t("members"),
            icon: Users,
            group: t("settingsAccess"),
          },
        ]
      : []),
    ...(canViewTrash
      ? [
          {
            section: "trash" as const,
            label: t("trash"),
            icon: Trash2,
            group: t("settingsContent"),
          },
        ]
      : []),
  ];
  return (
    <nav aria-label={t("spaceSettings")} className="rd-settings-nav">
      <ul>
        {items.map(({ section, label, icon: Icon, group }) => (
          <li key={section}>
            {group ? <h2>{group}</h2> : null}
            {section === "general" ? (
              <CurrentLink
                to="/spaces/$spaceId/settings"
                params={{ spaceId }}
                current={current === section}
                className="rd-issue-view"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                {label}
              </CurrentLink>
            ) : section === "members" ? (
              <CurrentLink
                to="/spaces/$spaceId/members"
                params={{ spaceId }}
                current={current === section}
                className="rd-issue-view"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                {label}
              </CurrentLink>
            ) : (
              <CurrentLink
                to="/spaces/$spaceId/trash"
                params={{ spaceId }}
                current={current === section}
                className="rd-issue-view"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                {label}
              </CurrentLink>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
