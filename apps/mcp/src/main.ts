import { parseExecutorConfig } from "./shared/config-executor.js";
import { parseGatewayConfig } from "./shared/config.js";

async function main(): Promise<void> {
  const role = process.env["MCP_ROLE"];
  if (role === "renderer") throw new Error("renderer is not implemented");
  if (role !== "gateway" && role !== "executor")
    throw new Error("MCP_ROLE must be one of gateway, executor, renderer");
  if (role === "executor") {
    process.on("SIGUSR1", () => {});
    await (await import("./executor/jobs/directories.js")).sweepJobDirectories();
  }
  const config =
    role === "gateway" ? parseGatewayConfig(process.env) : parseExecutorConfig(process.env);
  const gateway =
    "auth" in config
      ? (await import("./gateway/server.js")).createGateway(config)
      : (await import("./executor/server.js")).createExecutor(config);
  gateway.server.listen(config.PORT, config.HOST);
  gateway.server.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  const stop = () => {
    void gateway.close().finally(() => gateway.server.close());
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "MCP startup failed"}\n`);
  process.exitCode = 1;
});
