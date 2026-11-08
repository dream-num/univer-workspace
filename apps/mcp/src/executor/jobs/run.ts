import type { WorkspaceMaterializedDocument } from "@univerjs/univer-workspace-client-core/document-materialize";
import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { conversionError } from "./errors.js";
import type { ConversionJob, JobCredentials } from "./protocol.js";

const replySchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.union([z.instanceof(Uint8Array), z.record(z.string(), z.unknown())]),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      detail: z.object({ size: z.number(), maxBytes: z.number() }).optional(),
    }),
  }),
]);

export function jobEnvironment(directory: string): NodeJS.ProcessEnv {
  return { NODE_ENV: "production", HOME: directory, XDG_STATE_HOME: directory, TMPDIR: directory };
}

export function runConversionJob(
  job: Extract<ConversionJob, { kind: "markdown.materialize" }>,
  credentials: JobCredentials,
  signal: AbortSignal,
  entry?: URL,
  heapMb?: number,
): Promise<WorkspaceMaterializedDocument>;
export function runConversionJob(
  job: Extract<ConversionJob, { kind: "import" }>,
  credentials: JobCredentials,
  signal: AbortSignal,
  entry?: URL,
  heapMb?: number,
): Promise<Readonly<Record<string, unknown>>>;
export function runConversionJob(
  job: Extract<ConversionJob, { kind: "export" }>,
  credentials: JobCredentials,
  signal: AbortSignal,
  entry?: URL,
  heapMb?: number,
): Promise<Uint8Array>;
export async function runConversionJob(
  job: ConversionJob,
  credentials: JobCredentials,
  signal: AbortSignal,
  entry = new URL("./entry.js", import.meta.url),
  heapMb = 256,
): Promise<Uint8Array | Readonly<Record<string, unknown>> | WorkspaceMaterializedDocument> {
  signal.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), `univer-mcp-job-${process.pid}-`));
  try {
    signal.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const child = fork(entry, [], {
        serialization: "advanced",
        env: jobEnvironment(directory),
        execArgv: [`--max-old-space-size=${heapMb}`],
        cwd: directory,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      let reply: z.infer<typeof replySchema> | undefined;
      let failure: unknown;
      const abort = () => {
        failure = signal.reason;
        child.kill("SIGKILL");
      };
      signal.addEventListener("abort", abort, { once: true });
      child.once("error", () => {
        failure = workspaceError(
          "workspace-job-crashed",
          "The conversion job could not start or communicate.",
        );
        if (child.pid === undefined) {
          signal.removeEventListener("abort", abort);
          reject(failure);
        } else child.kill("SIGKILL");
      });
      child.once("message", (message: unknown) => {
        const parsed = replySchema.safeParse(message);
        if (parsed.success) reply = parsed.data;
        else child.kill("SIGKILL");
      });
      child.once("close", (code) => {
        signal.removeEventListener("abort", abort);
        if (failure) reject(failure);
        else if (code !== 0 || !reply)
          reject(
            workspaceError(
              "workspace-job-crashed",
              "The conversion job exited without a result, possibly exceeding its memory limit. Reduce the file or ask the operator to review EXECUTOR_JOB_HEAP_MB.",
            ),
          );
        else if (!reply.ok) {
          const error = conversionError(reply.error.code, reply.error.message);
          reject(
            workspaceError(
              error.code,
              error.message,
              error.code === "workspace-import-too-large" ? reply.error.detail : undefined,
            ),
          );
        } else if ((job.kind === "export") !== reply.value instanceof Uint8Array)
          reject(
            workspaceError(
              "workspace-job-crashed",
              "The conversion job returned an invalid result.",
            ),
          );
        else if (job.kind === "markdown.materialize") {
          const materialized = z
            .object({
              initialData: z.record(z.string(), z.unknown()),
              name: z.string().optional(),
              value: z.unknown().optional(),
            })
            .safeParse(reply.value);
          if (materialized.success) resolve(materialized.data);
          else reject(workspaceError("workspace-job-crashed", "Invalid materialized document."));
        } else resolve(reply.value);
      });
      child.send(job.kind === "import" ? job : { ...job, ...credentials }, (error) => {
        if (error) {
          failure = workspaceError(
            "workspace-job-crashed",
            "The conversion job could not start or communicate.",
          );
          child.kill("SIGKILL");
        }
      });
      if (signal.aborted) abort();
    });
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof Error && "syscall" in error)
      throw workspaceError(
        "workspace-job-crashed",
        "The conversion job could not start or communicate.",
      );
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
