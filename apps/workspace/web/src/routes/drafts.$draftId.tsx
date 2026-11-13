import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { HtmlViewDraftReview } from "../features/html-views/drafts/draft-review";

export const Route = createFileRoute("/drafts/$draftId")({
  beforeLoad: async ({ context, location }) => { await requireAuthenticatedSession(context.queryClient, location.href); },
  component: DraftPage,
});

function DraftPage() {
  return <HtmlViewDraftReview draftId={Route.useParams().draftId} presentation="page" />;
}
