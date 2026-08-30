import { resolve } from "node:path";
import type { Command } from "commander";
import { createWorkspaceConfig } from "../src/config.js";
import { createProgram } from "../src/program.js";

const cliRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(cliRoot, "../..");
const root = createProgram({
  config: createWorkspaceConfig({ HOME: repoRoot }),
  daemonEntry: new URL("file:///parity-daemon.mjs"),
  env: { HOME: repoRoot },
  renderPageRoot: repoRoot,
  resourceCacheRoot: resolve(repoRoot, ".parity-resource-cache"),
  resourceManifestPath: resolve(cliRoot, "resources/resources.json"),
  skillDataRoot: resolve(cliRoot, "skills"),
  socketPath: resolve(repoRoot, ".parity-daemon.sock"),
  write: () => undefined,
});
const routes: Array<{ arguments: string[]; options: string[]; path: string }> = [];

function visit(command: Command, parents: readonly string[]): void {
  const path = command === root ? "" : [...parents, command.name()].join(" ");
  routes.push({
    arguments: command.registeredArguments.map((argument) => {
      const name = `${argument.name()}${argument.variadic ? "..." : ""}`;
      return argument.required ? `<${name}>` : `[${name}]`;
    }),
    options: command.options.map(({ flags }) => flags).sort(),
    path,
  });
  for (const child of command.commands) visit(child, path === "" ? [] : path.split(" "));
}

visit(root, []);
process.stdout.write(JSON.stringify(routes));
