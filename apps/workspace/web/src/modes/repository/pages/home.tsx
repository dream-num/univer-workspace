import type { HomePageProps } from "../../page.types";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookMarked, Plus, Search } from "lucide-react";
import { useState } from "react";
import { sessionQueryOptions } from "../../../features/auth";
import { spacesQueryOptions } from "../../../features/spaces";
import { spaceDisplayName } from "../space-name";
import { useI18n, type MessageKey } from "../../../shared/i18n";
import { WorkspaceLayout, CreateTeamDialog } from "../../workspace-layout";
import { Button, Input, Segmented } from "../../../shared/ui";
import type { components } from "../../../../../generated/http/schema.js";

export function RepositoryHomePage(_props: HomePageProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const spaces = useQuery(spacesQueryOptions);
  const [searchQuery, setSearchQuery] = useState("");
  const session = useQuery(sessionQueryOptions);
  const personalSpace = spaces.data?.spaces.find((space) => space.type === "personal" && space.accessRole === "owner");
  const repositorySpaces = [
    ...(personalSpace ? [personalSpace] : []),
    ...(spaces.data?.spaces.filter((space) => space.type === "team") ?? []),
  ];
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "personal" | "team">("all");
  const filteredRepositories = repositorySpaces.filter(
    (space) =>
      (typeFilter === "all" || space.type === typeFilter) &&
      space.name.toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase()),
  );

  return (
    <WorkspaceLayout
      selectedView="home"
      repositoryHome={true}
      headerTitle={t("repositories")}
      headerContent={undefined}
    >
      {
        <div className="min-h-0 flex-1 overflow-y-auto bg-background">
          <div className="mx-auto max-w-6xl px-6 py-6 max-[720px]:px-4 max-[720px]:py-4">
            <div className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
              <div className="relative min-w-0 flex-1 sm:max-w-80">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground"
                  aria-hidden="true"
                />
                <Input
                  aria-label={t("searchRepositories")}
                  className="h-9 pl-9"
                  placeholder={t("searchRepositories")}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
              <Segmented
                aria-label={t("repositoryType")}
                size="sm"
                value={typeFilter}
                onValueChange={setTypeFilter}
                options={[
                  { label: t("allTypes"), value: "all" },
                  { label: t("personalSpace"), value: "personal" },
                  { label: t("teamSpace"), value: "team" },
                ]}
              />
              <Button className="ml-auto" onClick={() => setCreateTeamOpen(true)}>
                <Plus />
                {t("createTeamSpace")}
              </Button>
            </div>
            {repositorySpaces.length === 0 ? (
              <p className="py-6 text-muted-foreground">{t("repositoriesEmpty")}</p>
            ) : filteredRepositories.length === 0 ? (
              <p className="py-6 text-muted-foreground">{t("repositoriesNoMatch")}</p>
            ) : (
              <ul className="m-0 list-none divide-y divide-border p-0">
                {filteredRepositories.map((space) => {
                  const name =
                    spaceDisplayName(space, t, session.data?.authenticated ? session.data.user.username : undefined) ??
                    space.name;
                  const visibility =
                    space.type === "personal"
                      ? t("repositoryVisibilityPersonal")
                      : space.publicRead
                        ? t("repositoryVisibilityPublic")
                        : t("repositoryVisibilityPrivate");
                  return (
                    <li key={space.id}>
                      <Link
                        to="/spaces/$spaceId"
                        params={{ spaceId: space.id }}
                        className="flex items-center gap-3 rounded-md px-2 py-3.5 no-underline transition-colors hover:bg-accent/60"
                      >
                        <BookMarked className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate font-semibold text-primary">{name}</span>
                        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                          {visibility}
                        </span>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {t(accessRoleKey(space.accessRole))}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <CreateTeamDialog
              open={createTeamOpen}
              onOpenChange={setCreateTeamOpen}
              onCreated={async (space) => {
                await navigate({ to: "/spaces/$spaceId", params: { spaceId: space.id } });
              }}
            />
          </div>
        </div>
      }
    </WorkspaceLayout>
  );
}

function accessRoleKey(role: components["schemas"]["SpaceRole"]): MessageKey {
  if (role === "owner") return "accessOwner";
  if (role === "admin") return "accessAdmin";
  if (role === "editor") return "accessEditor";
  return "accessViewer";
}
