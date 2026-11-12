process.once("message", (job) => {
  const stderr =
    "native conversion failed\nAuthorization: Bearer fixture-secret\nfixture-private-content\n";
  process.stderr.write(
    (job.options.fileName === "large.xlsx" ? "discarded-prefix\n" + "x".repeat(64 * 1024) : "") +
      stderr,
    () => {
      if (job.options.fileName === "signal.xlsx") process.kill(process.pid, "SIGTERM");
      else if (job.options.fileName === "invalid.xlsx") process.send({ ok: "invalid" });
      else process.exit(7);
    },
  );
});
