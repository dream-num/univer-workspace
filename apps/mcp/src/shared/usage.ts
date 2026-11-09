import { z } from "zod";

export const costSchema = z.object({
  worker_cpu_ms: z.number().nonnegative(),
  worker_peak_rss_mb: z.number().nonnegative(),
  render_pages: z.number().nonnegative(),
  export_bytes: z.number().nonnegative(),
  upload_bytes: z.number().nonnegative(),
  committed_revisions: z.number().nonnegative(),
});
export type Cost = z.infer<typeof costSchema>;
export const zeroCost: Readonly<Cost> = {
  worker_cpu_ms: 0,
  worker_peak_rss_mb: 0,
  render_pages: 0,
  export_bytes: 0,
  upload_bytes: 0,
  committed_revisions: 0,
};
export const opMetaSchema = z
  .object({
    executor: z.enum(["cold_start", "warm", "none"]),
    cost: costSchema,
    repo: z.string().nullable().optional(),
    unitType: z.string().nullable().optional(),
  })
  .refine((meta) => meta.executor !== "none" || Object.values(meta.cost).every((v) => v === 0));
export type OpMeta = z.infer<typeof opMetaSchema>;

export class UsageAccumulator {
  private executor: OpMeta["executor"] = "none";
  private cost = { ...zeroCost };
  private repo: string | null = null;
  private unitType: string | null = null;

  addOp(meta: OpMeta): void {
    if (meta.executor === "cold_start" || this.executor === "none") this.executor = meta.executor;
    for (const key of Object.keys(zeroCost) as (keyof Cost)[]) {
      this.cost[key] =
        key === "worker_peak_rss_mb"
          ? Math.max(this.cost[key], meta.cost[key])
          : this.cost[key] + meta.cost[key];
    }
    this.repo = meta.repo ?? this.repo;
    this.unitType = meta.unitType ?? this.unitType;
  }

  addTransfer(kind: "upload_bytes" | "export_bytes", bytes: number): void {
    this.cost[kind] += bytes;
  }

  snapshot(): OpMeta {
    return {
      executor: this.executor,
      cost: { ...this.cost },
      repo: this.repo,
      unitType: this.unitType,
    };
  }
}
