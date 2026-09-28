import { Settings, Trash2, Users } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "../../shared/i18n";
import { spacesQueryOptions } from "./spaces.queries";

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
  const canManageMembers = space?.capabilities.manageMembers ?? false;
  const canViewTrash = space?.capabilities.viewTrash ?? false;
  const items: readonly {
    readonly section: SpaceSettingsSection;
    readonly label: string;
    readonly icon: typeof Settings;
  }[] = [
    { section: "general", label: t("settingsGeneral"), icon: Settings },
    ...(canManageMembers
      ? [{ section: "members" as const, label: t("members"), icon: Users }]
      : []),
    ...(canViewTrash ? [{ section: "trash" as const, label: t("trash"), icon: Trash2 }] : []),
  ];
  return (
    <nav
      aria-label={t("spaceSettings")}
      className="w-52 shrink-0 max-[720px]:w-full max-[720px]:overflow-x-auto"
    >
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {items.map(({ section, label, icon: Icon }) => (
          <li key={section}>
            {section === "general" ? (
              <Link
                to="/spaces/$spaceId/settings"
                params={{ spaceId }}
                aria-current={current === section ? "page" : undefined}
                className={settingsNavItemClass(current === section)}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            ) : section === "members" ? (
              <Link
                to="/spaces/$spaceId/members"
                params={{ spaceId }}
                aria-current={current === section ? "page" : undefined}
                className={settingsNavItemClass(current === section)}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            ) : (
              <Link
                to="/spaces/$spaceId/trash"
                params={{ spaceId }}
                aria-current={current === section ? "page" : undefined}
                className={settingsNavItemClass(current === section)}
              >
                <Icon className="size-4" />
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
    "flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium no-underline",
    current
      ? "bg-accent text-foreground"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  ].join(" ");
}
