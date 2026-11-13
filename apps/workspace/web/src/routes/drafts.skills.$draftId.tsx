import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { SkillDraftReview } from "../features/skill-drafts/draft-review";

export const Route = createFileRoute("/drafts/skills/$draftId")({
  beforeLoad: async ({ context, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
  },
  component: DraftPage,
});

function DraftPage() {
  return <SkillDraftReview draftId={Route.useParams().draftId} />;
}
