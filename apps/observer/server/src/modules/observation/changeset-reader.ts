import { Worker } from "node:worker_threads";
// The Worker opens Collaboration storage itself with read-only/query-only flags.
import type { ChangesetQuery, ChangesetQueryResult } from "./changeset-query-types.js";

export function queryChangesets(
  filename: string,
  query: ChangesetQuery,
  timeoutMs: number
): Promise<ChangesetQueryResult> {
  return new Promise((resolve, reject) => {
    const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
    const worker = new Worker(
      new URL(`./changeset-query-worker${extension}`, import.meta.url),
      { workerData: { filename, query } }
    );
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new ChangesetQueryTimeoutError(timeoutMs));
    }, timeoutMs);
    worker.once("message", (message: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const result = message as
        | { readonly ok: true; readonly result: ChangesetQueryResult }
        | { readonly ok: false; readonly error: string };
      if (result.ok) resolve(result.result);
      else reject(new Error(result.error));
      void worker.terminate();
    });
    worker.once("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    worker.once("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(
          new Error(
            `Changeset query Worker exited before returning a result (code ${code}).`
          )
        );
      }
    });
  });
}

export class ChangesetQueryTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Changeset query exceeded ${timeoutMs} ms.`);
    this.name = "ChangesetQueryTimeoutError";
  }
}
