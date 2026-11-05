import type { components } from "../../../../generated/http/schema.js";
import { QueryClient } from "@tanstack/react-query";
import { isNotFound } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../shared/api/client";
import { ensureSpace, mySpacesQueryOptions, spaceQueryOptions } from "./spaces.queries";

afterEach(() => vi.restoreAllMocks());

describe("Space detail route loading", () => {
  it("opens a public non-member Space absent from Yours", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(mySpacesQueryOptions.queryKey, { spaces: [] });
    const space = {
      id: "public", affiliation: "none", publicRead: true, type: "team", name: "Public",
      slug: "public", fullName: "other/public", description: "", accessRole: "viewer",
      owner: { id: "other", username: "other" },
      capabilities: {
        browseRoot: true, createAtRoot: false, renameSpace: false, manageMembers: false,
        viewTrash: false, createIssue: false, triageIssues: false, manageIssueLabels: false,
      },
    } satisfies components["schemas"]["SpaceView"];
    vi.spyOn(api, "GET").mockResolvedValue({ data: space, response: new Response() });
    expect(await ensureSpace(client, "public")).toEqual(space);
    expect(api.GET).toHaveBeenCalledWith("/api/spaces/{spaceId}", {
      params: { path: { spaceId: "public" } },
    });
    expect(client.getQueryData(spaceQueryOptions("public").queryKey)).toEqual(space);
    client.clear();
  });

  it("maps a detail HTTP 404 to the router's unavailable page", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(api, "GET").mockResolvedValue({
      error: { error: { code: "NOT_FOUND", message: "Unavailable" } },
      response: new Response(null, { status: 404 }),
    });
    const error = await ensureSpace(client, "hidden").catch((error: unknown) => error);
    expect(isNotFound(error)).toBe(true);
    client.clear();
  });

  it("preserves unexpected failures instead of turning them into 404s", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(api, "GET").mockRejectedValue(new Error("Network offline"));
    await expect(ensureSpace(client, "public")).rejects.toThrow("Network offline");
    client.clear();
  });
});
