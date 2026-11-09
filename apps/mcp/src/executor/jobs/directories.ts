import { lstat, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function sweepJobDirectories(root = tmpdir()) {
  for (const name of await readdir(root)) {
    const match = /^univer-mcp-job-(\d+)-[A-Za-z0-9]+$/.exec(name);
    if (!match) continue;
    // Startup precedes jobs, including when a container restarts with the same PID.
    const pid = Number(match[1]);
    if (pid !== process.pid) {
      try {
        process.kill(pid, 0);
        continue;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) continue;
      }
    }
    const directory = join(root, name);
    try {
      const stat = await lstat(directory);
      if (stat.isDirectory() && stat.uid === process.getuid?.())
        await rm(directory, { recursive: true, force: true });
    } catch (failure) {
      if (!(failure instanceof Error && "code" in failure && failure.code === "ENOENT"))
        throw failure;
    }
  }
}
