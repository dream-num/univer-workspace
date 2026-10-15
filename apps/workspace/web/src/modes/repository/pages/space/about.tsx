import { Link as LinkIcon, Settings, Star } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { spaceStarQueryOptions } from "../../../../features/spaces";
import { useI18n } from "../../../../shared/i18n";
import { buttonVariants } from "../../../../shared/ui";
import { cn } from "../../../../shared/utils/cn";
import type { SpaceView, RepositoryApp } from "./types";

export function RepositoryAbout({
  spaceId,
  space,
  selectedApp,
}: {
  readonly spaceId: string;
  readonly space: SpaceView;
  readonly selectedApp: RepositoryApp | undefined;
}) {
  const { t, language } = useI18n();
  const star = useQuery(spaceStarQueryOptions(spaceId));
  const description = space.description.trim();
  return (
    <aside aria-labelledby="repository-about-heading" className="min-w-0 self-start">
      <div className="flex items-center justify-between gap-2">
        <h2 id="repository-about-heading" className="m-0 text-base leading-6 font-semibold">
          {t("repositoryAbout")}
        </h2>
        {space.capabilities.renameSpace ? (
          <Link
            to="/spaces/$spaceId/settings"
            params={{ spaceId }}
            aria-label={t("repositoryAboutEditDescription")}
            title={t("repositoryAboutEditDescription")}
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "shrink-0 text-muted-foreground no-underline",
            )}
          >
            <Settings className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {description ? (
        <p className="mt-2 mb-0 text-sm leading-6 break-words text-foreground">{description}</p>
      ) : null}
      <ul className="m-0 mt-4 grid list-none gap-2 p-0 text-sm text-muted-foreground">
        {selectedApp ? (
          <li className="min-w-0">
            <Link
              to="/nodes/$nodeId"
              params={{ nodeId: selectedApp.node.id }}
              search={(previous) => ({ ...previous, view: "immersive" })}
              className="flex min-w-0 items-center gap-2 font-semibold text-brand-700 no-underline hover:underline dark:text-brand-400"
            >
              <LinkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{t("repositoryDefaultPage")}</span>
            </Link>
          </li>
        ) : null}
        <li className="flex items-center gap-2">
          <Star className="size-4 shrink-0" aria-hidden="true" />
          <span aria-live="polite">
            <strong className="font-semibold text-foreground tabular-nums">
              {star.data ? star.data.starCount.toLocaleString(language) : "…"}
            </strong>{" "}
            {t(star.data?.starCount === 1 ? "repositoryAboutStar" : "repositoryAboutStars")}
          </span>
        </li>
      </ul>
    </aside>
  );
}
