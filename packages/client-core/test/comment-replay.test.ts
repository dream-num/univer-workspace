import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { it } from "vitest";

// Exercise the real Node ESM graph the worker uses; see the fixture header.
it("keeps comment anchor resources for all five Unit types in the headless runtime", async () => {
  await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./fixtures/comment-replay-check.ts", import.meta.url)),
    ],
    { cwd: fileURLToPath(new URL("..", import.meta.url)) },
  );
}, 120_000);
