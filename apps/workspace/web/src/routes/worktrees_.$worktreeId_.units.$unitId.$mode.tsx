import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  redirect,
} from "@tanstack/react-router";
import {
  requireAuthenticatedSession,
  sessionQueryOptions,
} from "../features/auth";
import { ResourceEditor } from "../features/editor";
import {
  worktreeQueryOptions,
  worktreeUnitOpenQueryOptions,
} from "../features/worktrees";
import { reviewViewForOpenMode } from "../features/worktrees/worktree-review-search";

export const Route = createFileRoute(
  "/worktrees_/$worktreeId_/units/$unitId/$mode"
)({
  validateSearch: (search: Record<string, unknown>) => ({
    embedded:
      search.embedded === true || search.embedded === "true",
  }),
  beforeLoad: ({ params, search }) => {
    const mode = validMode(params.mode);
    if (!search.embedded) {
      throw redirect({
        to: "/worktrees",
        search: {
          worktree: params.worktreeId,
          unit: params.unitId,
          view: reviewViewForOpenMode(mode),
        },
        replace: true,
      });
    }
  },
  loader: async ({ context, params, location }) => {
    const mode = validMode(params.mode);
    await requireAuthenticatedSession(context.queryClient, location.href);
    await Promise.all([
      context.queryClient.ensureQueryData(
        worktreeUnitOpenQueryOptions(
          params.worktreeId,
          params.unitId,
          mode
        )
      ),
      context.queryClient.ensureQueryData(
        worktreeQueryOptions(params.worktreeId)
      ),
    ]);
  },
  component: WorktreeUnitPage,
});

function WorktreeUnitPage() {
  const { worktreeId, unitId, mode: modeValue } = Route.useParams();
  const mode = validMode(modeValue);
  const open = useQuery(
    worktreeUnitOpenQueryOptions(worktreeId, unitId, mode)
  );
  const worktree = useQuery(worktreeQueryOptions(worktreeId));
  const session = useQuery(sessionQueryOptions);
  if (!open.data || !worktree.data || !session.data?.authenticated) {
    return null;
  }
  return (
    <section className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-background">
      <ResourceEditor
        unitId={open.data.unit.unitId}
        unitType={open.data.unit.unitType}
        user={session.data.user}
        collaborationScope={open.data.collaborationScope}
        mappedUnitIds={worktree.data.worktree.units.map(
          (unit) => unit.unitId
        )}
        readOnly
      />
    </section>
  );
}

function validMode(
  value: string
): "draft" | "trunk" | "mergePreview" {
  if (
    value === "draft" ||
    value === "trunk" ||
    value === "mergePreview"
  ) {
    return value;
  }
  throw new Error("Unknown Worktree open mode.");
}
