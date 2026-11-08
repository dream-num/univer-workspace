import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { createAccessToken, revokeAccessToken } from "./access-tokens.commands";
import { accessTokensQueryOptions } from "./access-tokens.queries";
import { isAccessTokenExpired } from "./access-tokens.rules";

const record = {
  id: "pat-1",
  name: "My agent",
  scopes: ["read", "write", "worktree:merge"],
  createdAt: 1_800_000_000_000,
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
} satisfies components["schemas"]["PersonalAccessToken"];

afterEach(() => vi.restoreAllMocks());

describe("access tokens", () => {
  it.each([
    { expiresAt: null, expired: false },
    { expiresAt: record.createdAt - 1, expired: true },
    { expiresAt: record.createdAt, expired: false },
    { expiresAt: record.createdAt + 1, expired: false },
  ])("marks expiry $expiresAt as expired=$expired", ({ expiresAt, expired }) => {
    expect(isAccessTokenExpired(expiresAt, record.createdAt)).toBe(expired);
  });

  it("loads metadata through the account's cookie-authenticated API", async () => {
    vi.spyOn(api, "GET").mockResolvedValue({
      data: { tokens: [record] },
      response: new Response(),
    });
    const client = new QueryClient();
    try {
      expect(await client.fetchQuery(accessTokensQueryOptions)).toEqual({ tokens: [record] });
      expect(api.GET).toHaveBeenCalledWith("/api/auth/tokens");
    } finally {
      client.clear();
    }
  });

  it.each([null, 1_802_592_000_000])(
    "creates with an unchecked scope omitted and expiry %s",
    async (expiresAt) => {
      const created = { token: "one-time-secret", record: { ...record, expiresAt } };
      vi.spyOn(api, "POST").mockResolvedValue({
        data: created,
        response: new Response(null, { status: 201 }),
      });
      const body = { name: record.name, scopes: record.scopes, expiresAt };
      expect(await createAccessToken(body)).toEqual(created);
      expect(api.POST).toHaveBeenCalledWith("/api/auth/tokens", { body });
      expect(body.scopes).not.toContain("publish");
    },
  );

  it("revokes the selected token by ID", async () => {
    vi.spyOn(api, "DELETE").mockResolvedValue({
      data: undefined,
      response: new Response(null, { status: 204 }),
    });
    await revokeAccessToken(record.id);
    expect(api.DELETE).toHaveBeenCalledWith("/api/auth/tokens/{id}", {
      params: { path: { id: record.id } },
    });
  });

  it.each([400, 401, 403])(
    "preserves the API's creation error message for HTTP %s",
    async (status) => {
      vi.spyOn(api, "POST").mockResolvedValue({
        error: { error: { code: "FORBIDDEN", message: "Sign in directly to create tokens." } },
        response: new Response(null, { status }),
      });
      await expect(createAccessToken({ name: "My agent", scopes: ["read"] })).rejects.toThrow(
        "Sign in directly to create tokens.",
      );
    },
  );

  it("preserves list and revoke failures", async () => {
    const failure = {
      error: { error: { code: "UNAUTHORIZED", message: "Please sign in." } },
      response: new Response(null, { status: 401 }),
    };
    vi.spyOn(api, "GET").mockResolvedValue(failure);
    vi.spyOn(api, "DELETE").mockResolvedValue(failure);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      await expect(client.fetchQuery(accessTokensQueryOptions)).rejects.toThrow("Please sign in.");
      await expect(revokeAccessToken(record.id)).rejects.toThrow("Please sign in.");
    } finally {
      client.clear();
    }
  });
});
