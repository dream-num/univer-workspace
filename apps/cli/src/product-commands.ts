import type { Config } from "@univer-cli/config";
import {
  WorkspaceIssueFeature,
  WorkspaceSpaceFeature,
  WorkspaceWorktreeFeature,
} from "@univerjs/univer-workspace-client-core/product";
import { Command, type OutputConfiguration } from "commander";
import { workspaceSessionPath } from "./config.js";
import { createAuthCommand } from "./features/auth/command.js";
import { WorkspaceAuth } from "./features/auth/session.js";
import { createBrowseCommand } from "./features/browse/command.js";
import { createIssueCommand } from "./features/issue/command.js";
import { createLabelCommand } from "./features/label/command.js";
import { createPullRequestCommands } from "./features/pr/command.js";
import { createRepoCommand } from "./features/repo/command.js";
import { createSearchCommand } from "./features/search/command.js";
import { RepoContext } from "./repo-context.js";
import { WORKSPACE_CLI_VERSION } from "./version.js";

/**
 * The product commands (sign-in, repositories, Issues, pull requests) only talk HTTP to the
 * Workspace. They are built from the light Client Core entry so that running one of them does not
 * load the Univer runtime that content commands need.
 */
export const PRODUCT_COMMAND_NAMES: ReadonlySet<string> = new Set([
  "auth",
  "repo",
  "issue",
  "label",
  "pr",
  "worktree",
  "search",
  "browse",
]);

export interface ProductOptions {
  readonly config: Config;
  readonly env: NodeJS.ProcessEnv;
  readonly fetcher?: typeof fetch;
}

export function createProductServices(options: ProductOptions) {
  const auth = new WorkspaceAuth({
    config: options.config,
    sessionPath: workspaceSessionPath(options.env),
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
  });
  const authenticatedHttp = async () => await auth.authenticatedHttp("client");
  const origin = async () => await auth.configuredOrigin();
  const spaces = new WorkspaceSpaceFeature(authenticatedHttp);
  return {
    auth,
    authenticatedHttp,
    issues: new WorkspaceIssueFeature(authenticatedHttp),
    origin,
    repoContext: new RepoContext(spaces, origin, options.env),
    spaces,
    userId: async () => (await auth.whoami()).subject.id,
    worktrees: new WorkspaceWorktreeFeature(authenticatedHttp),
  };
}

export type ProductServices = ReturnType<typeof createProductServices>;

export function createProductCommands(services: ProductServices): readonly Command[] {
  const { auth, issues, origin, repoContext, spaces, userId, worktrees } = services;
  return [
    createAuthCommand(auth),
    createRepoCommand(spaces, repoContext),
    createIssueCommand({ context: repoContext, feature: issues, origin }),
    createLabelCommand(issues, repoContext),
    ...createPullRequestCommands({ context: repoContext, origin, spaces, userId, worktrees }),
    createSearchCommand(issues, worktrees, userId),
    createBrowseCommand({ context: repoContext, issues, origin, worktrees }),
  ];
}

export function createRootCommand(output: OutputConfiguration): Command {
  return new Command("uvw")
    .description("Work with Univer Workspace repositories, Issues, pull requests and files")
    .version(
      `univer-workspace-cli ${WORKSPACE_CLI_VERSION}`,
      "-v, --version",
      "output the current version",
    )
    .configureOutput(output);
}

/** The program for a product command alone; `main.ts` picks it so those commands start fast. */
export function createProductProgram(
  options: ProductOptions & {
    readonly write: (text: string) => void;
    readonly writeError?: (text: string) => void;
  },
): Command {
  const output = {
    writeErr: options.writeError ?? ((text: string) => process.stderr.write(text)),
    writeOut: options.write,
  };
  const program = createRootCommand(output);
  for (const command of createProductCommands(createProductServices(options))) {
    configureOutput(command, output);
    program.addCommand(command.helpGroup("Core commands:"));
  }
  return program;
}

export function configureOutput(command: Command, output: OutputConfiguration): void {
  command.configureOutput(output);
  for (const child of command.commands) configureOutput(child, output);
}
