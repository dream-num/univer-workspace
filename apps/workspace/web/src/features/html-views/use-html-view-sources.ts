import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { getHtmlViewUnitIds, parseHtmlView } from "@univerjs-labs/html-view";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export function useHtmlViewSources(html: string | undefined) {
  const sourceIds = useMemo(() => {
    if (html === undefined) return null;
    try { return getHtmlViewUnitIds(parseHtmlView(html)); } catch { return null; }
  }, [html]);
  const sources = useQueries({ queries: (sourceIds ?? []).map((unitId) => ({
    queryKey: ["unit-resources", unitId],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const { data, error } = await api.GET("/api/unit-resources/{unitId}", { params: { path: { unitId } }, signal });
      if (error) throw apiError(error);
      return data;
    },
    retry: false,
  })) });
  return { sourceIds, sources };
}
