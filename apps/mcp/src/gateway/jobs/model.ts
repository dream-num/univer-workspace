import { z } from "zod";

export const JOB_TTL_MS = 15 * 60_000;
export const jobHandleSchema = z.object({ job_id: z.uuid(), status: z.literal("running") });
export const jobErrorSchema = z.object({ code: z.string(), message: z.string(), detail: z.json() });
const jobBase = z.object({
  id: z.uuid(),
  userId: z.string().min(1),
  tool: z.enum(["import", "export", "compile_typst"]),
  key: z.string().optional(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.number(),
  deadlineAt: z.number(),
  expiresAt: z.number(),
});
export const jobRecordSchema = z.discriminatedUnion("status", [
  jobBase.extend({ status: z.literal("running") }),
  jobBase.extend({ status: z.literal("succeeded"), result: z.record(z.string(), z.json()) }),
  jobBase.extend({ status: z.literal("failed"), error: jobErrorSchema }),
]);
export type JobRecord = z.infer<typeof jobRecordSchema>;
export const jobViewSchema = z.discriminatedUnion("status", [
  jobHandleSchema,
  z.object({
    job_id: z.uuid(),
    status: z.literal("succeeded"),
    result: z.record(z.string(), z.json()),
  }),
  z.object({ job_id: z.uuid(), status: z.literal("failed"), error: jobErrorSchema }),
]);
