import { parseGatewayConfig } from "./shared/config.js";

async function main(): Promise<void> {
  const role = process.env["MCP_ROLE"];
  if (role === "executor" || role === "renderer")
    throw new Error(`${role} is not implemented in stage A`);
  if (role !== "gateway") throw new Error("MCP_ROLE must be one of gateway, executor, renderer");
  const config = parseGatewayConfig(process.env);
  const { createGateway } = await import("./gateway/server.js");
  const gateway = createGateway(config);
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
