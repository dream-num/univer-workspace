import { z } from "zod";

export const repoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["personal", "team"]).optional(),
  accessRole: z.enum(["owner", "admin", "editor", "viewer"]).optional(),
  affiliation: z.enum(["owner", "member", "none"]).optional(),
  description: z.string().optional(),
  fullName: z.string().nullable().optional(),
  owner: z.object({ id: z.string(), username: z.string() }).optional(),
  publicRead: z.boolean().optional(),
  slug: z.string().nullable().optional(),
  url: z.url(),
});
