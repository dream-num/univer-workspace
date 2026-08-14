import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import {
  requireAuthenticatedSession,
  sessionQueryKey,
  validLoginReturnTo,
} from "./auth.queries.js";

describe("validLoginReturnTo", () => {
  it.each([
    ["/nodes/node-1?mode=edit", "/nodes/node-1?mode=edit"],
    ["https://example.com/nodes/node-1", undefined],
    ["//example.com/nodes/node-1", undefined],
    ["/\\example.com/nodes/node-1", undefined],
    ["/login", undefined],
    [undefined, undefined],
  ])("normalizes %j to %j", (value, expected) => {
    expect(validLoginReturnTo(value)).toBe(expected);
  });
});

describe("requireAuthenticatedSession", () => {
  it("redirects an unauthenticated visitor before protected data loads", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sessionQueryKey, {
      authenticated: false,
      githubOAuthEnabled: false,
      discordOAuthEnabled: false,
    });

    try {
      await requireAuthenticatedSession(queryClient, "/spaces/space-1");
      expect.unreachable("Expected an authentication redirect.");
    } catch (error) {
      expect(isRedirect(error)).toBe(true);
      if (!isRedirect(error)) return;
      expect(error.options).toMatchObject({
        to: "/login",
        search: {
          oauthError: undefined,
          returnTo: "/spaces/space-1",
        },
      });
    }
  });
});
