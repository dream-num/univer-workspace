import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export const sessionQueryKey = ["session"] as const;

export const sessionQueryOptions = queryOptions({
  queryKey: sessionQueryKey,
  queryFn: async () => {
    const { data, error } = await api.GET("/api/session");
    if (error) throw apiError(error);
    return data;
  },
  staleTime: 30_000,
});

export function validLoginReturnTo(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  try {
    const base = "http://workspace.local";
    const url = new URL(value, base);
    if (url.origin !== base) return undefined;
    const localPath = `${url.pathname}${url.search}${url.hash}`;
    if (
      localPath === "/login" ||
      localPath.startsWith("/login?") ||
      localPath.startsWith("/login#")
    ) {
      return undefined;
    }
    return localPath;
  } catch {
    return undefined;
  }
}

export async function requireAuthenticatedSession(
  queryClient: QueryClient,
  returnTo?: string
) {
  const session = await queryClient.ensureQueryData(sessionQueryOptions);
  if (!session.authenticated) {
    throw redirect({
      to: "/login",
      search: {
        oauthError: undefined,
        returnTo: validLoginReturnTo(returnTo),
      },
    });
  }
  return session;
}
