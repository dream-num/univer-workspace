import { BookMarked, LockKeyhole, Star } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import { toast } from "../../shared/ui";
import { spaceDisplayName } from "./space-name";
import { spaceStarQueryOptions } from "./spaces.queries";

type Space = components["schemas"]["SpaceView"];

export function RepositoryHeader({ space }: { readonly space: Space }) {
  const { t } = useI18n();
  const name = spaceDisplayName(space, t) ?? space.name;
  const Icon = space.publicRead ? BookMarked : LockKeyhole;
  return (
    <div className="repository-chrome shrink-0 bg-background">
      <div className="mx-auto max-w-7xl px-8 max-[720px]:px-4">
        <div className="flex min-h-[69px] flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border py-5">
          <div className="flex min-w-0 items-center gap-2">
            <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <h1 className="m-0 min-w-0 text-xl leading-7 font-semibold">
              <Link
                to="/spaces/$spaceId"
                params={{ spaceId: space.id }}
                search={{}}
                className="break-all text-foreground no-underline hover:underline"
              >
                {name}
              </Link>
            </h1>
            <span className="shrink-0 rounded-full border border-border px-1.5 text-xs leading-[18px] font-medium text-muted-foreground">
              {t(space.publicRead ? "repositoryVisibilityPublic" : "repositoryVisibilityPrivate")}
            </span>
          </div>
          <RepositoryStar spaceId={space.id} name={name} />
        </div>
      </div>
    </div>
  );
}

function RepositoryStar({ spaceId, name }: { readonly spaceId: string; readonly name: string }) {
  const { t, language } = useI18n();
  const client = useQueryClient();
  const options = spaceStarQueryOptions(spaceId);
  const star = useQuery(options);
  const toggle = useMutation({
    mutationFn: async (starred: boolean) => {
      const request = { params: { path: { spaceId } } };
      const { data, error } = starred
        ? await api.PUT("/api/spaces/{spaceId}/star", request)
        : await api.DELETE("/api/spaces/{spaceId}/star", request);
      if (error) throw apiError(error);
      return data;
    },
    onMutate: async (starred) => {
      await client.cancelQueries({ queryKey: options.queryKey });
      const previous = client.getQueryData(options.queryKey);
      if (previous)
        client.setQueryData(options.queryKey, {
          starred,
          starCount: previous.starCount + (starred ? 1 : -1),
        });
      return previous;
    },
    onSuccess: (data) => client.setQueryData(options.queryKey, data),
    onError: (_error, _starred, previous) => {
      if (previous) client.setQueryData(options.queryKey, previous);
      toast.error(t("repositoryStarFailed"));
    },
    // Reconcile ambiguous network failures as well as successful writes.
    onSettled: () => client.invalidateQueries({ queryKey: options.queryKey }),
  });
  const starred = star.data?.starred === true;
  const label = star.isError && !star.data ? t("repositoryStarRetry") : starred ? "Unstar" : "Star";
  return (
    <button
      type="button"
      aria-label={`${label} ${name}`}
      aria-pressed={starred}
      aria-busy={toggle.isPending || star.isFetching}
      disabled={star.isPending || toggle.isPending}
      title={star.isError && !star.data ? t("repositoryStarFailed") : undefined}
      className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border-strong bg-secondary px-2 text-xs leading-5 font-medium text-foreground shadow-xs hover:bg-secondary-hover disabled:cursor-wait disabled:opacity-60"
      onClick={() => (star.isError && !star.data ? void star.refetch() : toggle.mutate(!starred))}
    >
      <Star
        aria-hidden="true"
        className={`size-4 ${starred ? "fill-repository-star text-repository-star" : "text-muted-foreground"}`}
      />
      {label}
      <span
        aria-live="polite"
        aria-atomic="true"
        className="ml-0.5 min-w-5 rounded-full bg-repository-counter px-1.5 text-center text-xs leading-[18px] tabular-nums"
      >
        {star.data ? star.data.starCount.toLocaleString(language) : "…"}
      </span>
    </button>
  );
}
