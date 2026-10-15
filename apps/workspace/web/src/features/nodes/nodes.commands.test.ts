import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { invalidateProductLists } from "./nodes.commands";

describe("invalidateProductLists", () => {
  it.each([
    { options: {}, optional: [] },
    { options: { spaceId: "a" }, optional: ["trash-a"] },
    { options: { htmlViews: true }, optional: ["html"] },
    { options: { spaceId: "a", htmlViews: true }, optional: ["trash-a", "html"] },
  ])("失效产品列表及明确指定的可选缓存：$options", async ({ options, optional }) => {
    const client = new QueryClient();
    const keys = {
      node: ["nodes", "one"],
      children: ["nodes", "one", "children"],
      space: ["nodes", "space", "a"],
      recent: ["recent-resources"],
      owned: ["owned-by-me"],
      shared: ["shared-with-me"],
      "trash-a": ["trash", "a"],
      "trash-b": ["trash", "b"],
      html: ["html-views"],
      unrelated: ["spaces"],
    };
    try {
      for (const key of Object.values(keys)) client.setQueryData(key, []);
      await invalidateProductLists(client, options);
      const invalidated = Object.entries(keys)
        .filter(([, key]) => client.getQueryState(key)?.isInvalidated)
        .map(([name]) => name);
      expect(invalidated).toEqual([
        "node",
        "children",
        "space",
        "recent",
        "owned",
        "shared",
        ...optional,
      ]);
    } finally {
      client.clear();
    }
  });

  it("等待活跃列表重新请求完成，再允许调用方继续", async () => {
    const client = new QueryClient();
    const key = ["shared-with-me"];
    client.setQueryData(key, "before");
    let finish!: (value: string) => void;
    const observer = new QueryObserver(client, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      let completed = false;
      const invalidation = invalidateProductLists(client).then(() => {
        completed = true;
      });
      await Promise.resolve();
      expect(completed).toBe(false);
      expect(client.getQueryState(key)?.fetchStatus).toBe("fetching");
      finish("after");
      await invalidation;
      expect(client.getQueryData(key)).toBe("after");
      expect(completed).toBe(true);
    } finally {
      unsubscribe();
      client.clear();
    }
  });
});
