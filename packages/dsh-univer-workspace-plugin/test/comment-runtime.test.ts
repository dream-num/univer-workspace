import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { it } from "vitest";

// Real Node ESM workers avoid splitting Vitest's inlined/external DI metadata.
it.each([
  [2, "Sheet"],
  [1, "Doc"],
  [3, "Slide"],
  [5, "Base"],
  [6, "Board"],
] as const)(
  "reproduces and repairs %s %s comment resource loss",
  async (type, _name) => {
    for (const mode of ["bare", "repaired", "viewer-bare", "viewer"]) {
      await promisify(execFile)(process.execPath, [
        "--import",
        "tsx",
        fileURLToPath(new URL("./fixtures/comment-runtime-check.ts", import.meta.url)),
        String(type),
        mode,
      ]);
    }
  },
  20_000,
);
