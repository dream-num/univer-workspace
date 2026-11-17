import inspector from "node:inspector";

process.once("message", async () => {
  process.debugPort = 0;
  process.kill(process.pid, "SIGUSR1");
  const started = Date.now();
  while (inspector.url() === undefined && Date.now() - started < 1000)
    await new Promise((resolve) => setTimeout(resolve, 20));
  process.send(
    { ok: true, value: { inspector: inspector.url() === undefined ? "closed" : "open" } },
    () => process.disconnect(),
  );
});
