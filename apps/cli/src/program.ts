#!/usr/bin/env node
import { createStandardApiReference } from "@univer-cli/api-reference";
import { createApiCommand } from "@univer-cli/api-reference-command";
import type { Config } from "@univer-cli/config";
import { createConfigCommand } from "@univer-cli/config-command";
import { createWorktreeContentInspectionCommand } from "@univer-cli/content-inspection-command";
import { createDaemonClient, createDaemonControl, type JsonValue } from "@univer-cli/daemon";
import { createDaemonCommand } from "@univer-cli/daemon-command";
import { createNodeResourceLibraryFactory } from "@univer-cli/resource-library";
import { createResourcesCommand } from "@univer-cli/resource-library-command";
import { createUnitExchange, type UnitExchange } from "@univer-cli/unit-exchange";
import type {
  UniverRenderRuntime,
  UniverRenderRuntimeOptions,
  UniverSlideLayoutRuntime,
  UniverTextMeasureRuntime,
} from "@univer-cli/univer-render-runtime";
import { Command, type OutputConfiguration } from "commander";
import { workspaceSessionPath } from "./config.js";
import { createAssetCommand } from "./features/asset/command.js";
import { WorkspaceAssetFeature } from "./features/asset/download.js";
import { createAuthCommands } from "./features/auth/command.js";
import { WorkspaceAuth } from "./features/auth/session.js";
import { createBlobCommand } from "./features/blob/command.js";
import { WorkspaceBlobFeature } from "./features/blob/transfer.js";
import { WorkspaceContentSource } from "./features/content/source.js";
import { createContentExecuteCommand } from "./features/content/command.js";
import { WorkspaceContentExecutionFeature } from "./features/content/execution.js";
import { createWorkspaceUnitExchangeCommands } from "./features/exchange/command.js";
import { WorkspaceUnitExchangeFeature } from "./features/exchange/exchange.js";
import { createWorkspaceUnitLayoutLintCommand } from "./features/lint/command.js";
import { WorkspaceUnitLayoutLintFeature } from "./features/lint/unit-layout-lint.js";
import { createOpenCommand } from "./features/open/command.js";
import { WorkspaceOpenFeature } from "./features/open/open.js";
import { createWorkspaceScreenshotCommand } from "./features/screenshot/command.js";
import { WorkspaceScreenshotFeature } from "./features/screenshot/screenshot.js";
import { createSkillsCommand } from "./features/skills/command.js";
import { createSpaceCommand } from "./features/space/command.js";
import { WorkspaceSpaceFeature } from "./features/space/space.js";
import { createWorkspaceCompileSvgCommand } from "./features/svg/command.js";
import { createWorkspaceCompileTypstCommand } from "./features/typst/command.js";
import { WorkspaceCompileTypstFeature } from "./features/typst/compile.js";
import { HeadlessWorkspaceTypstMaterializer } from "./features/typst/materialize.js";
import { createUnitCommand } from "./features/unit/command.js";
import { WorkspaceUnitFeature } from "./features/unit/membership.js";
import { createWorktreeCommand } from "./features/worktree/command.js";
import { WorkspaceWorktreeFeature } from "./features/worktree/management.js";
import { workspaceDaemonIdentity } from "./runtime/daemon-identity.js";
import { WORKSPACE_CLI_VERSION } from "./version.js";

export { DEFAULT_ORIGIN } from "./config.js";

export interface WorkspaceCliProgramOptions {
  readonly browserRuntimeRoot: string;
  readonly config: Config;
  readonly createRenderRuntime?: (
    options: UniverRenderRuntimeOptions,
  ) => Promise<UniverRenderRuntime>;
  readonly createSlideLayoutRuntime?: (
    options: UniverRenderRuntimeOptions,
  ) => Promise<UniverSlideLayoutRuntime & { close(): Promise<void> }>;
  readonly createTextMeasureRuntime?: (
    options: UniverRenderRuntimeOptions,
  ) => Promise<UniverTextMeasureRuntime>;
  readonly daemonEntry: URL;
  readonly env: NodeJS.ProcessEnv;
  readonly fetcher?: typeof fetch;
  readonly resourceCacheRoot: string;
  readonly resourceManifestPath: string;
  readonly socketPath: string;
  readonly skillDataRoot: string;
  readonly unitExchange?: UnitExchange;
  readonly write: (text: string) => void;
  readonly writeError?: (text: string) => void;
}

export function createProgram(options: WorkspaceCliProgramOptions): Command {
  const program = new Command("univer-workspace-cli")
    .description("Compose Univer CLI SDK capabilities for Workspace targets")
    .version(
      `univer-workspace-cli ${WORKSPACE_CLI_VERSION}`,
      "-v, --version",
      "output the current version",
    );
  const output = {
    writeErr: options.writeError ?? ((text: string) => process.stderr.write(text)),
    writeOut: options.write,
  };
  program.configureOutput(output);

  const daemonOptions = {
    entry: options.daemonEntry,
    env: options.env,
    identity: workspaceDaemonIdentity(options.env),
    socketPath: options.socketPath,
  };
  const daemon = createDaemonClient(daemonOptions);
  const daemonControl = createDaemonControl(daemonOptions);
  const auth = new WorkspaceAuth({
    config: options.config,
    sessionPath: workspaceSessionPath(options.env),
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
  });
  const worktrees = new WorkspaceWorktreeFeature(auth);
  const openResourceLibrary = createNodeResourceLibraryFactory({
    cacheRoot: options.resourceCacheRoot,
    manifestPath: options.resourceManifestPath,
    ...(options.fetcher === undefined ? {} : { downloader: { fetch: options.fetcher } }),
  });
  const contentExecution = new WorkspaceContentExecutionFeature(
    {
      resolveEditableRuntimeTarget: async (input) =>
        await new WorkspaceContentSource(
          await auth.authenticatedHttp("client"),
        ).resolveEditableRuntimeTarget(input),
    },
    daemon,
  );
  const units = new WorkspaceUnitFeature(auth);
  const compileTypst = new WorkspaceCompileTypstFeature({
    materializer: new HeadlessWorkspaceTypstMaterializer(),
    units,
  });
  const exchange = new WorkspaceUnitExchangeFeature({
    daemon,
    exchange: options.unitExchange ?? createUnitExchange(),
    createUnit: async (input) => await units.create(input),
    resolveRuntimeTarget: async (input) =>
      await new WorkspaceContentSource(await auth.authenticatedHttp("client")).resolveRuntimeTarget(
        input,
      ),
  });
  const screenshot = new WorkspaceScreenshotFeature({
    browserRuntimeRoot: options.browserRuntimeRoot,
    daemon,
    env: options.env,
    openSource: async () => new WorkspaceContentSource(await auth.authenticatedHttp("client")),
    ...(options.createRenderRuntime === undefined
      ? {}
      : { createRuntime: options.createRenderRuntime }),
  });
  const unitLayoutLint = new WorkspaceUnitLayoutLintFeature({
    browserRuntimeRoot: options.browserRuntimeRoot,
    env: options.env,
    source: screenshot,
    ...(options.createSlideLayoutRuntime === undefined
      ? {}
      : { createRuntime: options.createSlideLayoutRuntime }),
  });
  const commands = [
    createConfigCommand({ config: options.config }),
    createDaemonCommand({ control: daemonControl }),
    createApiCommand({ reference: createStandardApiReference() }),
    createResourcesCommand({ openLibrary: openResourceLibrary }),
    createSkillsCommand(options.skillDataRoot),
    ...createAuthCommands(auth),
    createSpaceCommand(new WorkspaceSpaceFeature(auth)),
    createWorktreeCommand(worktrees),
    createUnitCommand(units),
    ...createWorkspaceUnitExchangeCommands(exchange),
    createBlobCommand(new WorkspaceBlobFeature(auth)),
    createAssetCommand(new WorkspaceAssetFeature(auth)),
    createOpenCommand(new WorkspaceOpenFeature(auth, worktrees)),
    createWorkspaceScreenshotCommand({
      env: options.env,
      screenshot,
    }),
    createWorkspaceUnitLayoutLintCommand(unitLayoutLint),
    createContentExecuteCommand(contentExecution),
    createWorkspaceCompileTypstCommand(compileTypst),
    createWorkspaceCompileSvgCommand({
      browserRuntimeRoot: options.browserRuntimeRoot,
      env: options.env,
      executeSlide: async (input) => await contentExecution.executeSlide(input),
      ...(options.createTextMeasureRuntime === undefined
        ? {}
        : { createRuntime: options.createTextMeasureRuntime }),
    }),
    createWorktreeContentInspectionCommand({
      acquireRuntime: async ({ unitId, worktreeID }) => {
        const source = new WorkspaceContentSource(await auth.authenticatedHttp("client"));
        const target =
          worktreeID === undefined
            ? await source.resolveTrunkRuntimeTarget({ unitId })
            : await source.resolveRuntimeTarget({ unitId, worktreeId: worktreeID });
        return {
          unitId: target.unitId,
          unitType: target.unitType,
          execute: async ({ code }) => {
            const result = await daemon.request("runtime.execute-read", {
              code,
              target: {
                origin: target.origin,
                revision: target.revision,
                scope: target.scope,
                unitId: target.unitId,
                unitType: target.unitType,
              },
            });
            if (!isRecord(result) || !("value" in result)) {
              throw codedError("WORKSPACE_RUNTIME_RESULT_INVALID", "Runtime result is invalid");
            }
            return { value: result["value"] as JsonValue };
          },
          // Each daemon RPC owns and closes the underlying pool lease.
          invalidate: async () => undefined,
          release: async () => undefined,
        };
      },
    }),
  ];
  for (const command of commands) {
    configureOutput(command, output);
    program.addCommand(command);
  }
  return program;
}

function configureOutput(command: Command, output: OutputConfiguration): void {
  command.configureOutput(output);
  for (const child of command.commands) configureOutput(child, output);
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
