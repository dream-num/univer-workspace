import type { WorkspaceCompileTypstResult } from "@univerjs/univer-workspace-client-core";
import type { WorkspaceMaterializedDocument } from "@univerjs/univer-workspace-client-core/document-materialize";
import { fork } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WorkspaceApplicationError,
  workspaceError,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { conversionError, rewriteJobPaths } from "./errors.js";
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
      detail: z.json().optional(),
    }),
  }),
]);

export function jobEnvironment(directory: string): NodeJS.ProcessEnv {
  return { NODE_ENV: "production", HOME: directory, XDG_STATE_HOME: directory, TMPDIR: directory };
}

export function runConversionJob(
  job: Extract<ConversionJob, { kind: "typst.compile" }>,
  credentials: JobCredentials,
  signal: AbortSignal,
  entry?: URL,
  heapMb?: number,
): Promise<WorkspaceCompileTypstResult>;
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
): Promise<
  | Uint8Array
  | Readonly<Record<string, unknown>>
  | WorkspaceMaterializedDocument
  | WorkspaceCompileTypstResult
> {
  signal.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), `univer-mcp-job-${process.pid}-`));
  const diagnostics: Error & {
    jobKind: ConversionJob["kind"];
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stderrTail: string;
    startupErrorCode?: string;
  } = Object.assign(new Error("Conversion child process failed."), {
    jobKind: job.kind,
    exitCode: null,
    signal: null,
    stderrTail: "",
  });
  const crashed = (message: string, startupError?: unknown) => {
    const parsed = z
      .object({ code: z.string().regex(/^E[A-Z0-9_]{1,63}$/) })
      .safeParse(startupError);
    if (parsed.success) diagnostics.startupErrorCode = parsed.data.code;
    return new WorkspaceApplicationError("workspace-job-crashed", message, undefined, {
      cause: diagnostics,
    });
  };
  try {
    const directories = [...new Set([await realpath(directory), directory])];
    signal.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const child = fork(entry, [], {
        serialization: "advanced",
        env: jobEnvironment(directory),
        execArgv: [`--max-old-space-size=${heapMb}`],
        cwd: directory,
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      let stderrTail = Buffer.alloc(0);
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrTail = Buffer.concat([stderrTail, chunk]).subarray(-16 * 1024);
      });
      let reply: z.infer<typeof replySchema> | undefined;
      let failure: unknown;
      const abort = () => {
        failure = signal.reason;
        child.kill("SIGKILL");
      };
      signal.addEventListener("abort", abort, { once: true });
      child.once("error", (error) => {
        failure = crashed("The conversion job could not start or communicate.", error);
        if (child.pid === undefined) {
          signal.removeEventListener("abort", abort);
          reject(failure);
        } else child.kill("SIGKILL");
      });
      child.once("message", (message: unknown) => {
        const parsed = replySchema.safeParse(message);
        if (parsed.success) reply = parsed.data;
        else {
          failure = crashed("The conversion job returned an invalid result.");
          child.kill("SIGKILL");
        }
      });
      child.once("close", (code, terminationSignal) => {
        signal.removeEventListener("abort", abort);
        diagnostics.exitCode = code;
        diagnostics.signal = terminationSignal;
        diagnostics.stderrTail = stderrTail.toString("utf8");
        if (failure) reject(failure);
        else if (code !== 0 || !reply)
          reject(crashed("The conversion job exited without a result."));
        else if (!reply.ok) {
          const sanitized = replySchema.parse(rewriteJobPaths(reply, directories));
          if (!sanitized.ok) {
            const error = conversionError(sanitized.error.code, sanitized.error.message);
            reject(workspaceError(error.code, error.message, sanitized.error.detail));
          }
        } else if ((job.kind === "export") !== reply.value instanceof Uint8Array)
          reject(crashed("The conversion job returned an invalid result."));
        else if (job.kind === "typst.compile" && !(reply.value instanceof Uint8Array)) {
          const compiled = z
            .object({
              committed: z.literal(false),
              javascript: z.string(),
              title: z.string(),
              targetUnitId: z.string(),
              diagnostics: z.array(
                z.object({ sourcePath: z.string(), reason: z.string() }).loose(),
              ),
              previews: z.array(
                z.object({ pageId: z.string(), path: z.string(), sourcePath: z.string() }),
              ),
            })
            .safeParse({
              ...reply.value,
              diagnostics: rewriteJobPaths(reply.value["diagnostics"], directories),
              previews: rewriteJobPaths(reply.value["previews"], directories),
            });
          if (compiled.success) resolve(compiled.data as WorkspaceCompileTypstResult);
          else reject(crashed("Invalid Typst compilation result."));
        } else if (job.kind === "markdown.materialize") {
          const materialized = z
            .object({
              initialData: z.record(z.string(), z.unknown()),
              name: z.string().optional(),
              value: z.unknown().optional(),
            })
            .safeParse(reply.value);
          if (materialized.success) resolve(materialized.data);
          else reject(crashed("Invalid materialized document."));
        } else resolve(reply.value);
      });
      child.send(job.kind === "import" ? job : { ...job, ...credentials }, (error) => {
        if (error) {
          failure = crashed("The conversion job could not start or communicate.", error);
          child.kill("SIGKILL");
        }
      });
      if (signal.aborted) abort();
    });
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof Error && "syscall" in error)
      throw crashed("The conversion job could not start or communicate.", error);
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
