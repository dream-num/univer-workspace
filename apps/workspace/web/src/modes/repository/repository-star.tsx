import { Star } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useToggleSpaceStar } from "../../features/spaces/spaces.commands";
import { spaceStarQueryOptions } from "../../features/spaces/spaces.queries";
import { useI18n } from "../../shared/i18n";
import { toast } from "../../shared/ui";

export function RepositoryStar({
  spaceId,
  name,
  showCount = false,
}: {
  readonly spaceId: string;
  readonly name: string;
  readonly showCount?: boolean;
}) {
  const { t, language } = useI18n();
  const options = spaceStarQueryOptions(spaceId);
  const star = useQuery(options);
  const toggle = useToggleSpaceStar(spaceId);
  const starred = star.data?.starred === true;
  const label =
    star.isError && !star.data
      ? t("repositoryStarRetry")
      : starred
        ? t("repositoryUnstar")
        : t("repositoryStar");
  return (
    <button
      type="button"
      aria-label={`${label} ${name}`}
      aria-pressed={starred}
      aria-busy={toggle.isPending || star.isFetching}
      disabled={star.isPending || toggle.isPending}
      title={star.isError && !star.data ? t("repositoryStarFailed") : undefined}
      className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border-strong bg-secondary px-2 text-xs leading-5 font-medium text-foreground shadow-xs hover:bg-secondary-hover disabled:cursor-wait disabled:opacity-60"
      onClick={() => {
        if (star.isError && !star.data) void star.refetch();
        else toggle.mutate(!starred, { onError: () => toast.error(t("repositoryStarFailed")) });
      }}
    >
      <Star
        aria-hidden="true"
        className={`size-4 ${starred ? "fill-[var(--color-repository-star)] text-[color:var(--color-repository-star)]" : "text-muted-foreground"}`}
      />
      {label}
      {showCount ? (
        <span
          aria-live="polite"
          aria-atomic="true"
          className="ml-0.5 min-w-5 rounded-full bg-[var(--color-repository-counter)] px-1.5 text-center text-xs leading-[18px] tabular-nums"
        >
          {star.data ? star.data.starCount.toLocaleString(language) : "…"}
        </span>
      ) : null}
    </button>
  );
}
