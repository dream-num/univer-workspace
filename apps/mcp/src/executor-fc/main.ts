import { sweepJobDirectories } from "../executor/jobs/directories.js";
import {
  FC_MAX_JOBS,
  FC_MAX_WORKERS,
  createExecutorFc,
  parseFcExecutorConfig,
} from "./executor.js";

/**
 * FC custom-container entry. The resident `main.ts` selects the role with `MCP_ROLE`; FC
 * images run this file directly so the `executor-fc` layer stays separate from that switch.
 */
async function main(): Promise<void> {
  // The image starts every role with --disable-sigusr1; keep the signal inert in this entry too.
  process.on("SIGUSR1", () => {});
  await sweepJobDirectories();
  const config = parseFcExecutorConfig(process.env, process.execArgv);
  if (
    process.env["EXECUTOR_MAX_WORKERS"] !== undefined &&
    process.env["EXECUTOR_MAX_WORKERS"] !== "1"
  )
    process.stderr.write(
      `executor-fc pins EXECUTOR_MAX_WORKERS=${FC_MAX_WORKERS} and EXECUTOR_MAX_JOBS=${FC_MAX_JOBS} for FC session isolation\n`,
    );
  const executor = createExecutorFc(config);
  executor.server.listen(config.PORT, config.HOST);
  executor.server.on("error", (error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  const stop = () => {
    void executor.close().finally(() => executor.server.close());
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "MCP executor startup failed"}\n`,
  );
  process.exitCode = 1;
});
