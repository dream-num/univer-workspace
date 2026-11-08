import { queryOptions } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export const accessTokensQueryOptions = queryOptions({
  queryKey: ["access-tokens"],
  queryFn: async () => {
    const { data, error } = await api.GET("/api/auth/tokens");
    if (error) throw apiError(error);
    return data;
  },
});
