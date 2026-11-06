import type { Config } from "@univer-cli/config";
import type { DaemonControl } from "@univer-cli/daemon";
import type { Command } from "commander";
import { createConfigCommand } from "@univer-cli/config-command";
import { createDaemonCommand } from "@univer-cli/daemon-command";

export function createLifecycleCommands(options: {
  readonly config: Config;
  readonly control: DaemonControl;
}): readonly Command[] {
  return [
    createConfigCommand({ config: options.config }),
    createDaemonCommand({ control: options.control }),
  ];
}
