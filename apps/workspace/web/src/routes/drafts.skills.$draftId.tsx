import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedSession } from "../features/auth";
import { WorkspaceLayout } from "./-workspace-layout";
import { useSkillDraftMessages } from "../features/skill-drafts/messages";
import { SkillDraftReview } from "../features/skill-drafts/draft-review";

export const Route = createFileRoute("/drafts/skills/$draftId")({
  beforeLoad: async ({ context, location }) => {
    await requireAuthenticatedSession(context.queryClient, location.href);
  },
  component: DraftPage,
});

function DraftPage() {
  const m = useSkillDraftMessages();
  return <WorkspaceLayout repositoryView="agents" headerTitle={m.title}><SkillDraftReview draftId={Route.useParams().draftId} /></WorkspaceLayout>;
}
