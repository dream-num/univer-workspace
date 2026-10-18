import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

type HtmlViewItem = components["schemas"]["OwnedResourceItem"];

export const htmlViewsQueryKey = ["html-views"] as const;

export function htmlViewPagesQueryOptions(spaceId?: string) {
  return infiniteQueryOptions({
    queryKey: [...htmlViewsQueryKey, "pages", spaceId ?? "all"] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.GET("/api/html-views", {
        params: {
          query: {
            limit: 20,
            ...(spaceId ? { spaceId } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
      });
      if (error) throw apiError(error);
      return data;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function htmlViewsQueryOptions(spaceId?: string) {
  return queryOptions({
    queryKey: spaceId ? [...htmlViewsQueryKey, spaceId] : htmlViewsQueryKey,
    queryFn: async () => {
      const items: HtmlViewItem[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page += 1) {
        const { data, error } = await api.GET("/api/html-views", {
          params: {
            query: {
              limit: 200,
              ...(spaceId ? { spaceId } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        });
        if (error) throw apiError(error);
        items.push(...data.items);
        if (!data.nextCursor) return { items };
        cursor = data.nextCursor;
      }
      return { items };
    },
  });
}
