import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export async function createAccessToken(body: components["schemas"]["PersonalAccessTokenCreate"]) {
  const { data, error } = await api.POST("/api/auth/tokens", { body });
  if (error) throw apiError(error);
  return data;
}

export async function revokeAccessToken(id: string) {
  const { error } = await api.DELETE("/api/auth/tokens/{id}", {
    params: { path: { id } },
  });
  if (error) throw apiError(error);
}
