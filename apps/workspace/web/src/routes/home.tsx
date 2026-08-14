import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { requireAuthenticatedSession } from "../features/auth";
import { CreateNodeDropdown } from "../features/nodes";
import { spacesQueryOptions } from "../features/spaces";
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
import {
  WorkspaceHeaderSearch,
  WorkspaceLayout,
} from "./-workspace-layout";

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
  const spaces = useQuery(spacesQueryOptions);
  const { view = "recent" } = Route.useSearch();
  const [searchQuery, setSearchQuery] = useState("");
  const personalSpace = spaces.data?.spaces.find(
    (space) => space.type === "personal" && space.accessRole === "owner"
  );
  const tabs: readonly { readonly value: HomeView; readonly label: MessageKey }[] = [
    { value: "recent", label: "recent" },
    { value: "owned", label: "ownedByMe" },
    { value: "shared", label: "shared" },
  ];

  return (
    <WorkspaceLayout
      selectedView="home"
      headerContent={
        <WorkspaceHeaderSearch
          placeholder={t("searchNodes")}
          value={searchQuery}
          onChange={setSearchQuery}
        />
      }
    >
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
                  : "text-muted-foreground after:bg-transparent hover:text-foreground"
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
    </WorkspaceLayout>
  );
}

function isHomeView(value: unknown): value is HomeView {
  return value === "recent" || value === "owned" || value === "shared";
}
