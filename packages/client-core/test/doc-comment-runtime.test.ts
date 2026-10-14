import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { it } from "vitest";

// Exercise the real Node ESM graph used by workers. Mixing Vitest-inlined and
// external SDK modules splits DI decorator metadata across module instances.
it("preserves Doc comment resources and registers replay in the CLI headless runtime", async () => {
  await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./fixtures/doc-comment-runtime-check.ts", import.meta.url)),
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
    },
  );
}, 20_000);
