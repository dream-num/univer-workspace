import type { QueryClient } from "@tanstack/react-query";
import { trashQueryKey } from "../trash/trash.queries";
import { htmlViewsQueryKey } from "../views/html-views.queries";
import { ownedByMeQueryKey } from "../views/owned.queries";
import { recentResourcesQueryKey } from "../views/recent.queries";
import { sharedWithMeQueryKey } from "../views/shared.queries";

export async function invalidateProductLists(
  client: QueryClient,
  options: { readonly spaceId?: string; readonly htmlViews?: boolean } = {},
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["nodes"] }),
    client.invalidateQueries({ queryKey: recentResourcesQueryKey }),
    client.invalidateQueries({ queryKey: ownedByMeQueryKey }),
    client.invalidateQueries({ queryKey: sharedWithMeQueryKey }),
    ...(options.spaceId === undefined
      ? []
      : [client.invalidateQueries({ queryKey: trashQueryKey(options.spaceId) })]),
    ...(options.htmlViews
      ? [client.invalidateQueries({ queryKey: htmlViewsQueryKey })]
      : []),
  ]);
}
