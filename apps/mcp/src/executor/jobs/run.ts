import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import type { ConversionJob, JobCredentials } from "./protocol.js";

const replySchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.union([z.instanceof(Uint8Array), z.record(z.string(), z.unknown())]),
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

export function jobEnvironment(directory: string): NodeJS.ProcessEnv {
  return { NODE_ENV: "production", HOME: directory, XDG_STATE_HOME: directory, TMPDIR: directory };
}

export function runConversionJob(
  job: Extract<ConversionJob, { kind: "import" }>,
  credentials: JobCredentials,
  signal: AbortSignal,
  entry?: URL,
): Promise<Readonly<Record<string, unknown>>>;
export function runConversionJob(
  job: Extract<ConversionJob, { kind: "export" }>,
  credentials: JobCredentials,
  signal: AbortSignal,
  entry?: URL,
): Promise<Uint8Array>;
export async function runConversionJob(
  job: ConversionJob,
  credentials: JobCredentials,
  signal: AbortSignal,
  entry = new URL("./entry.js", import.meta.url),
): Promise<Uint8Array | Readonly<Record<string, unknown>>> {
  signal.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), "univer-mcp-job-"));
  try {
    signal.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const child = fork(entry, [], {
        serialization: "advanced",
        env: jobEnvironment(directory),
        execArgv: [],
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
      child.once("error", (error) => {
        failure = error;
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
            workspaceError("workspace-job-crashed", "The conversion job exited without a result."),
          );
        else if (!reply.ok) reject(workspaceError(reply.error.code, reply.error.message));
        else if ((job.kind === "export") !== reply.value instanceof Uint8Array)
          reject(
            workspaceError(
              "workspace-job-crashed",
              "The conversion job returned an invalid result.",
            ),
          );
        else resolve(reply.value);
      });
      child.send({ ...job, ...credentials }, (error) => {
        if (error) {
          failure = error;
          child.kill("SIGKILL");
        }
      });
      if (signal.aborted) abort();
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
