import { randomUUID } from "node:crypto";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { ExecutorCallError, resultUnknown, translateError } from "../../shared/errors.js";
import { downloadSchema, type StagingStore } from "../staging/model.js";
import type { ToolResult } from "../tools/definition.js";
import { JOB_DEADLINE_MS } from "../../shared/executor-protocol.js";
import { JOB_TTL_MS, type JobRecord } from "./model.js";

// A job never outlives the session that must finish it.
const GRANT_MARGIN_MS = 5_000;

function deadlineError(tool: JobRecord["tool"]) {
  return tool !== "export"
    ? resultUnknown("deadline", true)
    : {
        outcome: "timeout" as const,
        code: "workspace-executor-timeout",
        message: "The job deadline elapsed. Retry the read.",
        detail: { retryable: true },
      };
}

interface Entry {
  record: JobRecord;
  completion?: Promise<ToolResult>;
  detached?: boolean;
}
export class ToolJobs {
  private readonly entries = new Map<string, Entry>();
  private readonly keys = new Map<string, Promise<Entry>>();
  constructor(
    private readonly staging: StagingStore,
    private readonly syncBudgetMs = 30_000,
    private readonly now = Date.now,
    private readonly deadlineMs = JOB_DEADLINE_MS,
  ) {}

  private releaseKey(entry: Entry) {
    if (entry.record.key === undefined) return;
    const key = JSON.stringify([entry.record.userId, entry.record.tool, entry.record.key]);
    const pending = this.keys.get(key);
    void pending?.then(
      (current) => {
        if (current === entry && this.keys.get(key) === pending) this.keys.delete(key);
      },
      () => {},
    );
  }

  private prune() {
    for (const [id, entry] of this.entries) {
      if (entry.record.expiresAt > this.now()) continue;
      this.releaseKey(entry);
      this.entries.delete(id);
    }
  }

  async get(userId: string, id: string) {
    this.prune();
    const local = this.entries.get(id);
    const cached = local?.record;
    const record = cached?.status !== "running" ? cached : undefined;
    const job = record ?? (await this.staging.readJob(id));
    if (!job || job.userId !== userId || job.expiresAt <= this.now())
      throw workspaceError("workspace-job-not-found", "Job not found or expired.");
    // While this replica holds the unsettled completion, its deadline timer decides the outcome.
    if (job.status === "running" && job.deadlineAt <= this.now() && !local?.completion) {
      const { code, message, detail } = deadlineError(job.tool);
      return { job_id: id, status: "failed" as const, error: { code, message, detail } };
    }
    switch (job.status) {
      case "running":
        return { job_id: id, status: job.status };
      case "succeeded":
        return { job_id: id, status: job.status, result: job.result };
      case "failed":
        return { job_id: id, status: job.status, error: job.error };
    }
  }

  async run(input: {
    userId: string;
    tool: JobRecord["tool"];
    key: string | undefined;
    fingerprint: string;
    grantExpiresAt?: number | undefined;
    execute: (deadlineAt: number) => Promise<ToolResult>;
    onDeferred: (completion?: Promise<ToolResult>) => void;
  }): Promise<ToolResult> {
    this.prune();
    const startedAt = this.now();
    const key = JSON.stringify([input.userId, input.tool, input.key]);
    let pending = input.key === undefined ? undefined : this.keys.get(key);
    if (pending) {
      const entry = await pending;
      if (
        entry.record.status === "failed" ||
        entry.record.expiresAt <= this.now() ||
        (entry.record.status === "running" &&
          entry.record.deadlineAt <= this.now() &&
          !entry.completion)
      ) {
        if (this.keys.get(key) === pending) this.keys.delete(key);
        pending = undefined;
      } else assertSameIntent(entry.record, input.fingerprint);
    }
    const joined = pending !== undefined;
    if (!pending) {
      pending = this.start(input);
      if (input.key !== undefined) {
        this.keys.set(key, pending);
        void pending.catch(() => {
          if (this.keys.get(key) === pending) this.keys.delete(key);
        });
      }
    }
    const entry = await pending;
    if (!entry.completion) {
      if (this.keys.get(key) === pending) this.keys.delete(key);
      const current = await this.staging.readJob(entry.record.id);
      if (
        !current ||
        current.status === "failed" ||
        current.expiresAt <= this.now() ||
        (current.status === "running" && current.deadlineAt <= this.now())
      )
        return this.run(input);
      assertSameIntent(current, input.fingerprint);
      entry.record = current;
    }
    // Reusing work does not emit another conversion usage event.
    if (joined || !entry.completion) input.onDeferred();
    if (entry.record.status === "succeeded")
      return entry.completion ?? { output: entry.record.result, repo: null };
    if (entry.record.status === "failed") return entry.completion ?? this.run(input);
    const completion = entry.completion;
    if (!completion || (joined && entry.detached))
      return { output: { job_id: entry.record.id, status: "running" }, repo: null };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        completion,
        new Promise<ToolResult>((resolve) => {
          timer = setTimeout(
            () => {
              if (entry.record.status !== "running") {
                resolve(completion);
                return;
              }
              entry.detached = true;
              if (!joined) input.onDeferred(entry.completion);
              resolve({ output: { job_id: entry.record.id, status: "running" }, repo: null });
            },
            Math.max(0, this.syncBudgetMs - (this.now() - startedAt)),
          );
        }),
      ]);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  private async start(input: {
    userId: string;
    tool: JobRecord["tool"];
    key: string | undefined;
    fingerprint: string;
    grantExpiresAt?: number | undefined;
    execute: (deadlineAt: number) => Promise<ToolResult>;
  }): Promise<Entry> {
    const createdAt = this.now();
    // An expiring grant keeps today's behavior: the call is never capped below the synchronous budget,
    // and the executor rejects an expired grant itself.
    const deadlineAt =
      input.grantExpiresAt === undefined
        ? createdAt + this.deadlineMs
        : Math.min(
            createdAt + this.deadlineMs,
            Math.max(input.grantExpiresAt - GRANT_MARGIN_MS, createdAt + this.syncBudgetMs),
          );
    const candidate: JobRecord = {
      id: randomUUID(),
      userId: input.userId,
      tool: input.tool,
      ...(input.key === undefined ? {} : { key: input.key }),
      fingerprint: input.fingerprint,
      status: "running",
      createdAt,
      deadlineAt,
      expiresAt: deadlineAt + JOB_TTL_MS,
    };
    const record = await this.staging.reserveJob(candidate);
    const entry: Entry = { record };
    if (record.id !== candidate.id) return entry;
    this.entries.set(record.id, entry);
    entry.completion = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // The deadline also bounds response mapping after the executor call, so a completion always settles.
        const result = await Promise.race([
          input.execute(record.deadlineAt),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new ExecutorCallError(deadlineError(record.tool))),
              Math.max(0, record.deadlineAt - this.now()),
            );
            timer.unref();
          }),
        ]);
        const succeeded: JobRecord = {
          ...record,
          status: "succeeded",
          result: z.record(z.string(), z.json()).parse(result.output),
          expiresAt:
            record.tool === "export"
              ? Date.parse(
                  z.object({ download: downloadSchema }).parse(result.output).download.expires_at,
                )
              : this.now() + JOB_TTL_MS,
        };
        await this.staging.writeJob(succeeded);
        entry.record = succeeded;
        return result;
      } catch (error) {
        const { code, message, detail } = translateError(error);
        const { key: _key, ...identity } = record;
        const failed: JobRecord = {
          ...identity,
          status: "failed",
          error: { code, message, detail },
          expiresAt: this.now() + JOB_TTL_MS,
        };
        this.releaseKey(entry);
        entry.record = failed;
        // A lost sidecar write leaves a running sidecar that reads as failed after its deadline.
        await this.staging.writeJob(failed).catch(() => {});
        throw error;
      } finally {
        clearTimeout(timer);
      }
    })();
    // The HTTP caller can leave while the conversion finishes.
    void entry.completion.catch(() => {});
    return entry;
  }
}

function assertSameIntent(record: JobRecord, fingerprint: string) {
  if (record.fingerprint !== fingerprint)
    throw workspaceError(
      "workspace-idempotency-conflict",
      "idempotency_key is already associated with different arguments. Use a new key for a different request.",
    );
}
