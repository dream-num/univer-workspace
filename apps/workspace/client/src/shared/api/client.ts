import createClient from "openapi-fetch";
import type { paths } from "../../../../generated/http/schema.js";

export const api = createClient<paths>({
  baseUrl: "/",
  credentials: "include",
});
