import { parseExecutorConfig } from "./shared/config-executor.js";
import { parseGatewayConfig } from "./shared/config.js";
import { parseRendererConfig } from "./shared/config-renderer.js";

async function createRole(role: string | undefined) {
  if (role === "gateway") {
    const config = parseGatewayConfig(process.env);
    return { config, app: (await import("./gateway/server.js")).createGateway(config) };
  }
  if (role === "executor") {
    process.on("SIGUSR1", () => {});
    await (await import("./executor/jobs/directories.js")).sweepJobDirectories();
    const config = parseExecutorConfig(process.env);
    return { config, app: (await import("./executor/server.js")).createExecutor(config) };
  }
  if (role === "renderer") {
    const config = parseRendererConfig(process.env);
    return { config, app: (await import("./renderer/server.js")).createRenderer(config) };
  }
  throw new Error("MCP_ROLE must be one of gateway, executor, renderer");
}

async function main(): Promise<void> {
  const { config, app: gateway } = await createRole(process.env["MCP_ROLE"]);
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
