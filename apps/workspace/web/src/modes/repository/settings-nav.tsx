import { Settings, Trash2, Users } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "../../shared/i18n";
import { spacesQueryOptions } from "../../features/spaces/spaces.queries";
import { spaceSupportsMembers } from "../../features/spaces/space.rules";

export type SpaceSettingsSection = "general" | "members" | "trash";

/**
 * GitHub-style settings navigation for a Space. The repository theme renders it
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
  const spaces = useQuery(spacesQueryOptions);
  const space = spaces.data?.spaces.find((item) => item.id === spaceId);
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
    <nav aria-label={t("spaceSettings")} className="w-64 shrink-0 max-[767px]:w-full">
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {items.map(({ section, label, icon: Icon, group }) => (
          <li key={section} className={group ? "mt-2 border-t border-border pt-4" : undefined}>
            {group ? (
              <h2 className="mb-2 px-2 text-xs font-semibold text-muted-foreground">{group}</h2>
            ) : null}
            {section === "general" ? (
              <Link
                to="/spaces/$spaceId/settings"
                params={{ spaceId }}
                aria-current={current === section ? "page" : undefined}
                className={settingsNavItemClass(current === section)}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                {label}
              </Link>
            ) : section === "members" ? (
              <Link
                to="/spaces/$spaceId/members"
                params={{ spaceId }}
                aria-current={current === section ? "page" : undefined}
                className={settingsNavItemClass(current === section)}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                {label}
              </Link>
            ) : (
              <Link
                to="/spaces/$spaceId/trash"
                params={{ spaceId }}
                aria-current={current === section ? "page" : undefined}
                className={settingsNavItemClass(current === section)}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                {label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function settingsNavItemClass(current: boolean): string {
  return [
    "relative flex min-h-8 items-center gap-2 rounded-md px-2 text-sm no-underline before:absolute before:-left-2 before:top-1 before:bottom-1 before:w-1 before:rounded-full",
    current
      ? "bg-accent font-semibold text-foreground before:bg-ring"
      : "text-foreground hover:bg-accent",
  ].join(" ");
}
