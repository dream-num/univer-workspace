import { useModeDefinition } from "../modes/registry";
import { createFileRoute } from "@tanstack/react-router";

import { requireAuthenticatedSession } from "../features/auth";

import { parseWorktreeDashboardSearch } from "../features/worktrees/worktree-review-search";

export const Route = createFileRoute("/worktrees")({
  validateSearch: parseWorktreeDashboardSearch,
  loader: async ({ context, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
  },
  component: WorktreesPage,
});

function WorktreesPage() {
  const props = Route.useSearch();
  const { pages } = useModeDefinition();
  return <pages.worktrees {...props} />;
}
