import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BookMarked, Plus, Search } from "lucide-react";
import { useTheme } from "../shared/theme";
import { useState } from "react";
import { requireAuthenticatedSession, sessionQueryOptions } from "../features/auth";
import { CreateNodeDropdown } from "../features/nodes";
import { spaceDisplayName, spacesQueryOptions } from "../features/spaces";
import {
  OwnedByMe,
  RecentResources,
  SharedWithMe,
  ownedByMeQueryOptions,
  recentResourcesQueryOptions,
  sharedWithMeQueryOptions,
} from "../features/views";
import { useI18n, type MessageKey } from "../shared/i18n";
import { cn } from "../shared/utils/cn";
import { WorkspaceHeaderSearch, WorkspaceLayout, CreateTeamDialog } from "./-workspace-layout";
import { spacesQueryKey } from "../features/spaces";
import { Button, Input, Segmented } from "../shared/ui";
import type { components } from "../../../generated/http/schema.js";

type HomeView = "recent" | "owned" | "shared";

export const Route = createFileRoute("/home")({
  validateSearch: (search: Readonly<Record<string, unknown>>) => ({
    ...(isHomeView(search.view) ? { view: search.view } : {}),
  }),
  loader: async ({ context, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
    await Promise.all([
      context.queryClient.ensureQueryData(recentResourcesQueryOptions),
      context.queryClient.ensureQueryData(ownedByMeQueryOptions),
      context.queryClient.ensureQueryData(sharedWithMeQueryOptions),
      context.queryClient.ensureQueryData(spacesQueryOptions),
    ]);
  },
  component: HomePage,
});

function HomePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { workspaceTheme } = useTheme();
  const spaces = useQuery(spacesQueryOptions);
  const queryClient = useQueryClient();
  const { view = "recent" } = Route.useSearch();
  const [searchQuery, setSearchQuery] = useState("");
  const session = useQuery(sessionQueryOptions);
  const personalSpace = spaces.data?.spaces.find(
    (space) => space.type === "personal" && space.accessRole === "owner",
  );
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
  const tabs: readonly { readonly value: HomeView; readonly label: MessageKey }[] = [
    { value: "recent", label: "recent" },
    { value: "owned", label: "ownedByMe" },
    { value: "shared", label: "shared" },
  ];

  return (
    <WorkspaceLayout
      selectedView="home"
      repositoryHome={workspaceTheme === "repository"}
      headerTitle={workspaceTheme === "repository" ? t("repositories") : undefined}
      headerContent={
        workspaceTheme === "repository" ? undefined : (
          <WorkspaceHeaderSearch
            placeholder={t("searchNodes")}
            value={searchQuery}
            onChange={setSearchQuery}
          />
        )
      }
    >
      {workspaceTheme === "repository" ? (
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
              <Button
                className="ml-auto"
                onClick={() => setCreateTeamOpen(true)}
              >
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
                    spaceDisplayName(
                      space,
                      t,
                      session.data?.authenticated ? session.data.user.username : undefined,
                    ) ?? space.name;
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
                        <span className="min-w-0 truncate font-semibold text-primary">
                          {name}
                        </span>
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
                await queryClient.invalidateQueries({ queryKey: spacesQueryKey });
                await navigate({ to: "/spaces/$spaceId", params: { spaceId: space.id } });
              }}
            />
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col bg-background">
          <div className="grid shrink-0 grid-cols-2 gap-3 bg-gradient-to-b from-surface/55 to-background px-6 pt-4 pb-3 max-[720px]:grid-cols-1 max-[720px]:px-4 max-[720px]:pt-3">
            <CreateNodeDropdown
              {...(personalSpace ? { spaceId: personalSpace.id } : {})}
              placement="home"
              action="create"
            />
            <CreateNodeDropdown
              {...(personalSpace ? { spaceId: personalSpace.id } : {})}
              placement="home"
              action="upload"
            />
          </div>
          <div
            role="tablist"
            aria-label={t("homeViews")}
            className="flex h-12 shrink-0 items-end gap-7 border-b border-border px-6 max-[720px]:gap-5 max-[720px]:px-4"
          >
            {tabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={view === tab.value}
                className={cn(
                  "relative h-full cursor-pointer border-0 bg-transparent px-0.5 pt-1 text-[13px] font-medium transition-colors outline-none",
                  "after:absolute after:right-0.5 after:bottom-0 after:left-0.5 after:h-0.5 after:rounded-full after:transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring/40",
                  view === tab.value
                    ? "text-foreground after:bg-brand-600"
                    : "text-muted-foreground after:bg-transparent hover:text-foreground",
                )}
                onClick={() => {
                  void navigate({
                    to: "/home",
                    search: tab.value === "recent" ? {} : { view: tab.value },
                    replace: true,
                  });
                }}
              >
                {t(tab.label)}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="min-h-0 flex-1">
            {view === "recent" ? (
              <RecentResources searchQuery={searchQuery} />
            ) : view === "owned" ? (
              <OwnedByMe searchQuery={searchQuery} />
            ) : (
              <SharedWithMe searchQuery={searchQuery} />
            )}
          </div>
        </div>
      )}
    </WorkspaceLayout>
  );
}

function isHomeView(value: unknown): value is HomeView {
  return value === "recent" || value === "owned" || value === "shared";
}

function accessRoleKey(role: components["schemas"]["SpaceRole"]): MessageKey {
  if (role === "owner") return "accessOwner";
  if (role === "admin") return "accessAdmin";
  if (role === "editor") return "accessEditor";
  return "accessViewer";
}
