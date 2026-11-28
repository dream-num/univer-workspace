import { QueryClient } from "@tanstack/react-query";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionQueryKey } from "../features/auth";
import { ApiError } from "../shared/api/errors";

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

vi.mock("../shared/api/client", () => ({
  api: { GET: apiGet, POST: apiPost },
}));
vi.mock("../modes/registry", () => ({ useModeDefinition: () => ({ pages: {} }) }));
vi.mock("./-workspace-layout", () => ({ WorkspaceLayout: () => null }));
vi.mock("../features/nodes/remix", () => ({ SaveMyVersionButton: () => null, useFinishPendingCopy: () => undefined }));
vi.mock("../features/editor", () => ({ ResourceEditor: () => null }));
vi.mock("../features/blobs", () => ({ BlobPreview: () => null }));

import { Route as NodeRoute } from "./nodes.$nodeId";
import { Route as SpaceRoute } from "./spaces.$spaceId";

const unauthenticatedSession = {
  authenticated: false,
  githubOAuthEnabled: false,
  googleOAuthEnabled: false,
  discordOAuthEnabled: false,
  passwordAuthEnabled: true,
  emailAuthEnabled: false,
};

const authenticatedSession = {
  ...unauthenticatedSession,
  authenticated: true,
  user: { id: "u1", username: "alice", displayName: "Alice", avatarUrl: null, kind: "human" },
};

function makeClient(authenticated: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQueryKey, authenticated ? authenticatedSession : unauthenticatedSession);
  if (authenticated) {
    queryClient.setQueryData(["spaces", "my"], { spaces: [{ id: "space-1" }] });
  }
  return queryClient;
}

function runNodeLoader(queryClient: QueryClient, nodeId: string, href: string) {
  const loader = NodeRoute.options.loader as unknown as (ctx: {
    context: { queryClient: QueryClient };
    deps: { unit?: string };
    params: { nodeId: string };
    location: { href: string; searchStr: string };
  }) => Promise<unknown>;
  return loader({
    context: { queryClient },
    deps: {},
    params: { nodeId },
    location: { href, searchStr: "" },
  });
}

function runSpaceLoader(queryClient: QueryClient, spaceId: string, href: string) {
  const loader = SpaceRoute.options.loader as unknown as (ctx: {
    context: { queryClient: QueryClient };
    params: { spaceId: string };
    location: { href: string };
  }) => Promise<unknown>;
  return loader({
    context: { queryClient },
    params: { spaceId },
    location: { href },
  });
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

const apiNotFound = { error: { error: { code: "NOT_FOUND", message: "Not found" } } };
const apiInternalError = { error: { error: { code: "INTERNAL_ERROR", message: "Boom" } } };

describe("/nodes/$nodeId loader", () => {
  it("redirects unauthenticated NOT_FOUND to /login preserving ?view=immersive and hash", async () => {
    apiGet.mockResolvedValue(apiNotFound);
    const queryClient = makeClient(false);
    const href = "/nodes/node-1?view=immersive#chart";

    try {
      await runNodeLoader(queryClient, "node-1", href);
      expect.unreachable("Expected redirect to login");
    } catch (error) {
      expect(isRedirect(error)).toBe(true);
      if (!isRedirect(error)) return;
      expect(error.options).toMatchObject({
        to: "/login",
        search: { oauthError: undefined, returnTo: href },
      });
    }
  });

  it("throws notFound() when authenticated receives NOT_FOUND", async () => {
    apiGet.mockResolvedValue(apiNotFound);
    const queryClient = makeClient(true);

    try {
      await runNodeLoader(queryClient, "node-1", "/nodes/node-1");
      expect.unreachable("Expected notFound");
    } catch (error) {
      expect(isRedirect(error)).toBe(false);
      expect(isNotFound(error)).toBe(true);
    }
  });

  it("does not redirect when unauthenticated node read succeeds (200)", async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === "/api/nodes/{nodeId}") {
        return { data: { node: { id: "node-1", resource: { id: "res-1" }, capabilities: { browseChildren: false } } } };
      }
      throw new Error(`Unexpected GET path ${path}`);
    });
    apiPost.mockImplementation(async (path: string) => {
      if (path === "/api/resources/{resourceId}/open") {
        return { data: { resource: { id: "res-1", kind: "blob" } } };
      }
      throw new Error(`Unexpected POST path ${path}`);
    });
    const queryClient = makeClient(false);

    await expect(runNodeLoader(queryClient, "node-1", "/nodes/node-1?view=immersive")).resolves.toBeUndefined();
  });

  it("rethrows non-NOT_FOUND errors without redirecting", async () => {
    apiGet.mockResolvedValue(apiInternalError);
    const queryClient = makeClient(false);

    try {
      await runNodeLoader(queryClient, "node-1", "/nodes/node-1");
      expect.unreachable("Expected error");
    } catch (error) {
      expect(isRedirect(error)).toBe(false);
      expect(isNotFound(error)).toBe(false);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("INTERNAL_ERROR");
    }
  });
});

describe("/spaces/$spaceId loader", () => {
  it("redirects unauthenticated NOT_FOUND to /login preserving location.href", async () => {
    apiGet.mockResolvedValue(apiNotFound);
    const queryClient = makeClient(false);
    const href = "/spaces/space-1?view=files";

    try {
      await runSpaceLoader(queryClient, "space-1", href);
      expect.unreachable("Expected redirect to login");
    } catch (error) {
      expect(isRedirect(error)).toBe(true);
      if (!isRedirect(error)) return;
      expect(error.options).toMatchObject({
        to: "/login",
        search: { oauthError: undefined, returnTo: href },
      });
    }
  });

  it("throws notFound() when authenticated receives NOT_FOUND", async () => {
    apiGet.mockResolvedValue(apiNotFound);
    const queryClient = makeClient(true);

    try {
      await runSpaceLoader(queryClient, "space-1", "/spaces/space-1");
      expect.unreachable("Expected notFound");
    } catch (error) {
      expect(isRedirect(error)).toBe(false);
      expect(isNotFound(error)).toBe(true);
    }
  });

  it("does not redirect when unauthenticated space read succeeds (200)", async () => {
    apiGet.mockResolvedValue({ data: { nodes: [] } });
    const queryClient = makeClient(false);

    await expect(runSpaceLoader(queryClient, "space-1", "/spaces/space-1")).resolves.toBeUndefined();
  });

  it("rethrows non-NOT_FOUND errors without redirecting", async () => {
    apiGet.mockResolvedValue(apiInternalError);
    const queryClient = makeClient(false);

    try {
      await runSpaceLoader(queryClient, "space-1", "/spaces/space-1");
      expect.unreachable("Expected error");
    } catch (error) {
      expect(isRedirect(error)).toBe(false);
      expect(isNotFound(error)).toBe(false);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("INTERNAL_ERROR");
    }
  });
});
