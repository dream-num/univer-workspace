import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import { Separator } from "../../shared/ui";
import { useHtmlViewSources } from "../html-views/use-html-view-sources";
import { nodeQueryOptions } from "../nodes/nodes.queries";
import { resourceOpenQueryOptions } from "../resources/resources.queries";

export function SourceSheets({ nodeId, linkSharingEnabled }: {
  readonly nodeId: string;
  readonly linkSharingEnabled: boolean;
}) {
  const { t } = useI18n();
  const node = useQuery(nodeQueryOptions(nodeId));
  const resourceId = node.data?.node.resource?.id;
  const opened = useQuery({ ...resourceOpenQueryOptions(resourceId ?? ""), enabled: resourceId !== undefined });
  const resource = opened.data?.resource;
  const contentUrl = resource?.kind === "blob" ? resource.contentUrl : undefined;
  const content = useQuery({
    queryKey: ["html-view-sources", contentUrl],
    enabled: contentUrl !== undefined,
    queryFn: async ({ signal }) => {
      if (!contentUrl) throw new Error("HTML view content is unavailable");
      const response = await fetch(contentUrl, { credentials: "include", signal });
      if (!response.ok) throw new Error("HTML view could not be loaded");
      return response.text();
    },
  });
  const { sourceIds, sources } = useHtmlViewSources(content.data);
  const publicPage = useQuery({
    queryKey: ["anonymous-node-access", nodeId, linkSharingEnabled],
    queryFn: async ({ signal }) => {
      const { error, response } = await api.GET("/api/nodes/{nodeId}", {
        params: { path: { nodeId } }, credentials: "omit", cache: "no-store", signal,
      });
      if (response.status === 403 || response.status === 404) return false;
      if (error) throw apiError(error);
      return true;
    },
    retry: false,
  });
  const publicAudience = linkSharingEnabled || publicPage.data === true;
  const publicSources = useQueries({ queries: (sourceIds ?? []).map((unitId) => ({
    queryKey: ["anonymous-unit-access", unitId],
    enabled: publicAudience,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      // Let the server apply inherited link sharing and repository visibility.
      const { error, response } = await api.GET("/api/unit-resources/{unitId}", {
        params: { path: { unitId } }, credentials: "omit", cache: "no-store", signal,
      });
      if (response.status === 403 || response.status === 404) return false;
      if (error) throw apiError(error);
      return true;
    },
    retry: false,
  })) });
  const unreadable = publicAudience && publicSources.some((source) => source.data === false);
  const unavailable = node.isError || opened.isError || content.isError || (content.data !== undefined && sourceIds === null);
  return <section aria-label={t("shareSourceSheets")}>
    <Separator className="my-5" />
    <h3 className="m-0 text-sm font-semibold">{t("shareSourceSheets")}</h3>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("shareSourceLiveData")}</p>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("shareSourcePeopleAccess")}</p>
    {sourceIds === null ? <p role="status" className="text-xs">{t(unavailable ? "shareSourcesUnavailable" : "dashboardLoading")}</p> :
      sourceIds.length === 0 ? <p className="text-xs">{t("shareSourceNone")}</p> :
        <ul className="mt-2 grid gap-2">
          {sourceIds.map((unitId, index) => {
            const source = sources[index];
            const access = publicSources[index];
            return <li key={unitId} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <a className="min-w-0 break-all text-primary underline" target="_blank" rel="noreferrer"
                href={source?.data ? `/nodes/${encodeURIComponent(source.data.node.id)}` : `/preview/${encodeURIComponent(unitId)}`}>
                {source?.data?.node.name ?? unitId}
              </a>
              <span className="text-muted-foreground">{source?.isError ? t("shareSourceMetadataUnavailable") :
                source?.isPending ? t("dashboardLoading") : publicAudience ?
                  access?.data === true ? t("shareSourceReadable") : access?.data === false ? t("shareSourceUnreadable") :
                    access?.isError ? t("shareSourcesUnavailable") : t("dashboardLoading") : t("shareSourceCheckPeople")}</span>
            </li>;
          })}
        </ul>}
    {unreadable && <p role="alert" className="mt-3 text-xs leading-5 text-destructive">{t("shareSourceWarning")}</p>}
    {publicPage.isError && !linkSharingEnabled && <p role="status" className="text-xs">{t("shareSourcesUnavailable")}</p>}
  </section>;
}
