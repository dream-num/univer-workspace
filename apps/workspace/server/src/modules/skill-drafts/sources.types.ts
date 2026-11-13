import { z } from "zod";
import { safeSkillPath } from "./scan.js";

const coordinate = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_.-]+$/)
  .refine((s) => s !== "." && s !== "..");
const sourcePath = z
  .string()
  .max(1024)
  .refine((s) => s === "" || safeSkillPath(s));
export const resolvedSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("git"),
      hub: z.enum(["github", "skills-sh"]),
      owner: coordinate,
      repo: coordinate,
      commit: z.string().regex(/^[a-f0-9]{40}$/),
      path: sourcePath,
      pageUrl: z.string().max(2048),
    })
    .strict(),
  z
    .object({
      kind: z.literal("clawhub"),
      owner: coordinate,
      slug: coordinate,
      version: z
        .string()
        .min(1)
        .max(255)
        .regex(/^[A-Za-z0-9_.+-]+$/),
      pageUrl: z.string().max(2048),
    })
    .strict(),
  z
    .object({
      kind: z.literal("space"),
      nodeId: z.string().uuid(),
      etag: z.string().min(1).max(100),
    })
    .strict(),
]);
export type ResolvedSource = z.infer<typeof resolvedSourceSchema>;
export const sourceReadSchema = z
  .object({
    source: z.union([z.string().min(1).max(4096), resolvedSourceSchema]),
    skill: z.string().min(1).max(1024).optional(),
    path: z.string().min(1).max(1024).optional(),
    cursor: z.string().min(1).max(1024).optional(),
  })
  .strict()
  .refine((s) => (!s.path || !!s.skill) && (!s.cursor || !!s.path));
export const fromSourceSchema = z
  .object({
    source: resolvedSourceSchema,
    skill: z.string().min(1).max(1024),
    overrides: z
      .array(z.object({ path: z.string().min(1).max(1024), text: z.string().nullable() }).strict())
      .max(100)
      .default([]),
  })
  .strict();
export type SourceInput =
  | {
      kind: "git";
      hub: "github" | "skills-sh";
      owner: string;
      repo: string;
      ref: string;
      path: string;
      skill?: string;
    }
  | { kind: "clawhub"; owner: string; slug: string; version?: string }
  | { kind: "space"; nodeId: string };
