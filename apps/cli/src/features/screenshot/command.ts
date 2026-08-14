import {
  installUniverRenderBrowser,
  probeUniverRenderBrowser,
  resolveUniverRenderBrowser,
} from "@univer-cli/univer-render-runtime";
import {
  createUnitScreenshotCommand,
  type UniverRenderBrowserSetupCommandDependencies,
} from "@univer-cli/unit-screenshot-command";
import { Option, type Command } from "commander";
import { workspaceError } from "../../errors.js";
import type { WorkspaceRuntimeScope } from "../../runtime/target.js";
import type { WorkspaceScreenshotApplication } from "./screenshot.js";

interface WorkspaceScreenshotCommandOptions {
  readonly trunk?: boolean;
  readonly worktree?: string;
}

export function createWorkspaceScreenshotCommand(input: {
  readonly browserSetup?: UniverRenderBrowserSetupCommandDependencies;
  readonly env: NodeJS.ProcessEnv;
  readonly screenshot: WorkspaceScreenshotApplication;
}): Command {
  let command: Command;
  command = createUnitScreenshotCommand({
    browserSetup: input.browserSetup ?? browserSetup(input.env),
    loadUnit: async ({ unitId }) =>
      await input.screenshot.loadUnit({
        scope: screenshotScope(command.opts<WorkspaceScreenshotCommandOptions>()),
        ...(unitId === undefined ? {} : { unitId }),
      }),
    screenshot: { capture: async (captureInput) => await input.screenshot.capture(captureInput) },
    writeImages: async (writeInput) => await input.screenshot.writeImages(writeInput),
  });
  command.description("Render a Workspace Unit as PNG images");
  command.addOption(
    new Option("--worktree <worktree-id>", "capture the Unit from a Worktree").conflicts("trunk"),
  );
  command.addOption(new Option("--trunk", "capture the Unit from trunk").conflicts("worktree"));
  const output = command.options.find((option) => option.long === "--out");
  if (output !== undefined) output.description = "Output directory (default ./screenshots)";
  return command;
}

function screenshotScope(options: WorkspaceScreenshotCommandOptions): WorkspaceRuntimeScope {
  if (options.trunk === true) return { kind: "trunk" };
  const worktreeId = options.worktree?.trim();
  if (worktreeId !== undefined && worktreeId !== "") {
    return { kind: "worktree", worktreeId };
  }
  throw workspaceError(
    "workspace-screenshot-scope-required",
    "Workspace screenshot requires --worktree <worktree-id> or --trunk.",
  );
}

function browserSetup(env: NodeJS.ProcessEnv): UniverRenderBrowserSetupCommandDependencies {
  return {
    install: async () => await installUniverRenderBrowser({ env }),
    probe: async (options) => await probeUniverRenderBrowser(options),
    resolve: async () => await resolveUniverRenderBrowser({ env }),
  };
}
