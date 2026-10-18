import { ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { resourceShareUrl } from "../../../../features/resource-view/resource-view";
import { formatRelativeDate } from "../../../../shared/format-relative-date";
import { useI18n } from "../../../../shared/i18n";
import { toast } from "../../../../shared/ui";
import type { RepositoryApp } from "./types";
import { displayAppName } from "./display-app-name";

export function AppsView({
  spaceId,
  apps,
  selectedApp,
  onSelectApp,
}: {
  readonly spaceId: string;
  readonly apps: readonly RepositoryApp[];
  readonly selectedApp: RepositoryApp | undefined;
  readonly onSelectApp: (nodeId: string) => void;
}) {
  const { language, t } = useI18n();
  const defaultPageUrl = selectedApp
    ? resourceShareUrl(window.location.origin, selectedApp.node.id, "immersive")
    : undefined;
  const copyDefaultPageUrl = async () => {
    if (!defaultPageUrl) return;
    try {
      await navigator.clipboard.writeText(defaultPageUrl);
      toast.success(t("repositoryPageLinkCopied"));
    } catch {
      toast.error(t("repositoryCopyPageLinkFailed"));
    }
  };
  return (
    <section aria-labelledby="repository-pages-heading">
      <div>
        <h1
          id="repository-pages-heading"
          className="m-0 mb-4 border-b border-border pb-[0.3em] text-[2em] leading-[1.25] font-semibold"
        >
          {t("apps")}
        </h1>
        <p className="m-0 mb-4">{t("repositoryAppsSummary", { count: apps.length })}</p>
      </div>
      {selectedApp ? (
        <div className="my-6">
          <div className="min-w-0">
            <h2 className="m-0 mb-4 border-b border-border pb-[0.3em] text-2xl leading-[1.25] font-semibold break-words">
              {t("repositoryDefaultPage")}:{" "}
              <Link to="/nodes/$nodeId" params={{ nodeId: selectedApp.node.id }}>
                {displayAppName(selectedApp.node.name)}
              </Link>
            </h2>
            <p className="m-0 mb-4 min-w-0">
              <code className="rounded-[3px] bg-surface px-[0.4em] py-[0.2em] text-[85%] break-all">
                {defaultPageUrl}
              </code>
            </p>
            <p className="m-0 mb-4 text-muted-foreground">{t("repositoryDefaultPageLocalOnly")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              className="repository-pages-action"
              onClick={() => void copyDefaultPageUrl()}
            >
              {t("repositoryCopyPageLink")}
            </button>
            <Link
              to="/nodes/$nodeId"
              params={{ nodeId: selectedApp.node.id }}
              search={(previous) => ({ ...previous, view: "immersive" })}
              className="inline-flex items-center gap-1"
            >
              {t("repositoryVisitPage")}
              <ExternalLink className="size-3.5" />
            </Link>
          </div>
        </div>
      ) : null}
      {apps.length ? (
        <ul className="m-0 mb-4 list-disc pl-8">
          {apps.map((app) => {
            const isDefault = selectedApp?.node.id === app.node.id;
            return (
              <li key={app.node.id} className="mt-4">
                <div className="flex flex-col items-start justify-between gap-x-4 gap-y-1 sm:flex-row">
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/nodes/$nodeId"
                      params={{ nodeId: app.node.id }}
                      className="break-words"
                    >
                      {displayAppName(app.node.name)}
                    </Link>
                    <p className="m-0 mt-1 text-sm break-words text-muted-foreground">
                      {app.node.name} · {formatRelativeDate(app.node.updatedAt, language)}
                    </p>
                  </div>
                  {isDefault ? (
                    <span className="text-sm leading-6 text-muted-foreground">
                      {t("repositoryIsDefaultPage")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="repository-pages-action"
                      onClick={() => onSelectApp(app.node.id)}
                    >
                      {t("repositorySetDefaultPage")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div>
          <h2 className="mt-6 mb-4 border-b border-border pb-[0.3em] text-2xl leading-[1.25] font-semibold">
            {t("repositoryNoApps")}
          </h2>
          <p className="m-0 mb-4">{t("appsEmptyDescription")}</p>
          <p className="m-0 mb-4">{t("appsEmptyHint")}</p>
        </div>
      )}
    </section>
  );
}
