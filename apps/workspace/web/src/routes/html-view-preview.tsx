import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { LocalPreview } from "../features/html-views/local-preview/local-preview";
import { loadPreviewWorktree } from "../features/html-views/local-preview/pull-request";
import { parsePreviewSearch } from "../features/html-views/local-preview/source";

export const Route = createFileRoute("/html-view-preview")({
  validateSearch: parsePreviewSearch,
  beforeLoad: async ({ context, location }) => { await requireAuthenticatedSession(context.queryClient, location.href); },
  loaderDeps: ({ search }) => ({ repo: search.repo, pr: search.pr }),
  loader: ({ context, deps }) => loadPreviewWorktree(context.queryClient, deps),
  errorComponent: ({ error }) => <p role="alert" className="p-6">{error.message}</p>,
  component: HtmlViewPreview,
});

function HtmlViewPreview() {
  return <LocalPreview search={Route.useSearch()} worktree={Route.useLoaderData().worktree} />;
}
