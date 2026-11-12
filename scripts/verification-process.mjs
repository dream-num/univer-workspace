import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";

export async function runProcess(
  argv,
  {
    cwd = process.cwd(),
    env = process.env,
    directory,
    forwardSignals = true,
    processGroup = false,
  } = {},
) {
  const stdout = directory && createWriteStream(`${directory}/stdout.log`, { flags: "wx" });
  const stderr = directory && createWriteStream(`${directory}/stderr.log`, { flags: "wx" });
  const writes = [stdout, stderr].filter(Boolean).map((stream) => finished(stream));
  for (const write of writes) write.catch(() => {});
  const grouped = processGroup && process.platform !== "win32";
  const child = spawn(argv[0], argv.slice(1), {
    cwd,
    env,
    stdio: ["inherit", "pipe", "pipe"],
    detached: grouped,
  });
  let spawnError = null;
  child.on("error", (error) => {
    spawnError = error.message;
  });
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  if (stdout) child.stdout.pipe(stdout);
  if (stderr) child.stderr.pipe(stderr);
  let interruptedBy = null;
  const forward = (signal) => {
    interruptedBy = signal;
    if (!child.pid) return;
    try {
      if (grouped) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const onInt = () => forward("SIGINT");
  const onTerm = () => forward("SIGTERM");
  if (forwardSignals) {
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
  }
  const result = await new Promise((resolve) =>
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal, spawnError })),
  );
  process.off("SIGINT", onInt);
  process.off("SIGTERM", onTerm);
  const writeResults = await Promise.allSettled(writes);
  const outputError =
    writeResults.find((write) => write.status === "rejected")?.reason?.message ?? null;
  return {
    ...result,
    interruptedBy,
    outputError,
    status:
      result.exitCode === 0 &&
      !result.signal &&
      !result.spawnError &&
      !outputError &&
      !interruptedBy
        ? "passed"
        : "failed",
  };
}
