#!/usr/bin/env node
import { createStandardApiReference } from "@univer-cli/api-reference";
import { createApiCommand } from "@univer-cli/api-reference-command";
import type { Config } from "@univer-cli/config";
import { createWorktreeContentInspectionCommand } from "@univer-cli/content-inspection-command";
import { createDaemonClient, createDaemonControl, type JsonValue } from "@univer-cli/daemon";
import { createNodeResourceLibraryFactory } from "@univer-cli/resource-library";
import { createResourcesCommand } from "@univer-cli/resource-library-command";
import type {
  UniverPrintPdfRuntime,
  UniverRenderRuntime,
  UniverRenderRuntimeOptions,
  UniverTextMeasureRuntime,
} from "@univer-cli/univer-render-runtime";
import {
  HeadlessWorkspaceTypstMaterializer,
  WorkspaceAssetFeature,
  WorkspaceBlobFeature,
  WorkspaceCompileTypstFeature,
  WorkspaceCompileSvgFeature,
  WorkspaceContentExecutionFeature,
  WorkspaceContentSource,
  WorkspacePrintPdfFeature,
  WorkspaceRenderUnitLoader,
  WorkspaceScreenshotFeature,
  WorkspaceUnitExchangeFeature,
  WorkspaceUnitFeature,
  WorkspaceUnitLayoutLintFeature,
} from "@univerjs/univer-workspace-client-core";
import type { Command } from "commander";
import { resolveUniverLicense } from "./config.js";
import { createAssetCommand } from "./features/asset/command.js";
import { createBlobCommand } from "./features/blob/command.js";
import { createContentExecuteCommand } from "./features/content/command.js";
import { createWorkspaceDaemonRuntimeOperations } from "./features/content/execution.js";
import { createWorkspaceUnitExchangeCommands } from "./features/exchange/command.js";
import { createHtmlViewCommand } from "./features/html-view/command.js";
import { WorkspaceHtmlViewFeature } from "./features/html-view/html-view.js";
import { createWorkspaceUnitLayoutLintCommand } from "./features/lint/command.js";
import { createWorkspacePrintPdfCommand } from "./features/print-pdf/command.js";
import { createWorkspaceScreenshotCommand } from "./features/screenshot/command.js";
import { createSkillsCommand } from "./features/skills/command.js";
import { createSpaceCommand } from "./features/space/command.js";
import { createWorkspaceCompileSvgCommand } from "./features/svg/command.js";
import { createWorkspaceCompileTypstCommand } from "./features/typst/command.js";
import { createUnitCommand } from "./features/unit/command.js";
import {
  configureOutput,
  createProductCommands,
  createProductServices,
  createRootCommand,
} from "./product-commands.js";
import { createLifecycleCommands } from "./lifecycle-commands.js";
import { workspaceDaemonIdentity } from "./runtime/daemon-identity.js";
import { WORKSPACE_CLI_VERSION } from "./version.js";

export { DEFAULT_ORIGIN } from "./config.js";

export interface WorkspaceCliProgramOptions {
  readonly renderPageRoot: string;
  readonly config: Config;
  readonly createRenderRuntime?: (
    options: UniverRenderRuntimeOptions,
  ) => Promise<UniverRenderRuntime>;
  readonly createPrintPdfRuntime?: (
    options: UniverRenderRuntimeOptions,
  ) => Promise<UniverPrintPdfRuntime>;
  readonly createLayoutRuntime?: ConstructorParameters<
    typeof WorkspaceUnitLayoutLintFeature
  >[0]["createRuntime"];
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
  readonly write: (text: string) => void;
  readonly writeError?: (text: string) => void;
}

export function createProgram(options: WorkspaceCliProgramOptions): Command {
  const output = {
    writeErr: options.writeError ?? ((text: string) => process.stderr.write(text)),
    writeOut: options.write,
  };
  const program = createRootCommand(output);

  const daemonOptions = {
    entry: options.daemonEntry,
    env: options.env,
    identity: workspaceDaemonIdentity(options.env),
    socketPath: options.socketPath,
  };
  const daemon = createDaemonClient(daemonOptions);
  const runtimeOperations = createWorkspaceDaemonRuntimeOperations(daemon);
  const daemonControl = createDaemonControl(daemonOptions);
  const product = createProductServices(options);
  const { auth, authenticatedHttp, spaces } = product;
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
    runtimeOperations,
  );
  const units = new WorkspaceUnitFeature(authenticatedHttp);
  const blobs = new WorkspaceBlobFeature(authenticatedHttp);
  const compileTypst = new WorkspaceCompileTypstFeature({
    materializer: new HeadlessWorkspaceTypstMaterializer(),
    units,
  });
  const exchange = new WorkspaceUnitExchangeFeature({
    runtime: runtimeOperations,
    resolveImageAsset: async (input) =>
      await new WorkspaceContentSource(await auth.authenticatedHttp("client")).resolveImageAsset(
        input,
      ),
    createUnit: async (input) => await units.create(input),
    resolveRuntimeTarget: async (input) =>
      await new WorkspaceContentSource(await auth.authenticatedHttp("client")).resolveRuntimeTarget(
        input,
      ),
  });
  const renderUnitLoader = new WorkspaceRenderUnitLoader({
    runtime: runtimeOperations,
    openSource: async () => new WorkspaceContentSource(await auth.authenticatedHttp("client")),
  });
  const license = resolveUniverLicense(options.env);
  const screenshot = new WorkspaceScreenshotFeature({
    renderPageRoot: options.renderPageRoot,
    license,
    env: options.env,
    loader: renderUnitLoader,
    ...(options.createRenderRuntime === undefined
      ? {}
      : { createRuntime: options.createRenderRuntime }),
  });
  const printPdf = new WorkspacePrintPdfFeature({
    renderPageRoot: options.renderPageRoot,
    license,
    env: options.env,
    loader: renderUnitLoader,
    ...(options.createPrintPdfRuntime === undefined
      ? {}
      : { createRuntime: options.createPrintPdfRuntime }),
  });
  const unitLayoutLint = new WorkspaceUnitLayoutLintFeature({
    renderPageRoot: options.renderPageRoot,
    license,
    env: options.env,
    loader: renderUnitLoader,
    ...(options.createLayoutRuntime === undefined
      ? {}
      : { createRuntime: options.createLayoutRuntime }),
  });
  const compileSvg = new WorkspaceCompileSvgFeature({
    contentExecution,
    renderPageRoot: options.renderPageRoot,
    license,
    env: options.env,
    ...(options.createTextMeasureRuntime === undefined
      ? {}
      : { createRuntime: options.createTextMeasureRuntime }),
  });
  const commands = [
    ...createLifecycleCommands({ config: options.config, control: daemonControl }),
    createApiCommand({ reference: createStandardApiReference() }),
    createResourcesCommand({ openLibrary: openResourceLibrary }),
    createSkillsCommand(options.skillDataRoot),
    ...createProductCommands(product),
    createSpaceCommand(spaces, product.repoContext),
    createUnitCommand(units),
    ...createWorkspaceUnitExchangeCommands(exchange),
    createBlobCommand(blobs),
    createHtmlViewCommand(
      new WorkspaceHtmlViewFeature({
        blobs,
        runtime: runtimeOperations,
        configuredOrigin: async () => await auth.configuredOrigin(),
        resolveTrunkRuntimeTarget: async (input) =>
          await new WorkspaceContentSource(await authenticatedHttp()).resolveTrunkRuntimeTarget(
            input,
          ),
      }),
    ),
    createAssetCommand(
      new WorkspaceAssetFeature(async () => await auth.authenticatedHttp("client")),
    ),
    createWorkspaceScreenshotCommand({
      env: options.env,
      screenshot,
    }),
    createWorkspacePrintPdfCommand(printPdf),
    createWorkspaceUnitLayoutLintCommand(unitLayoutLint),
    createContentExecuteCommand(contentExecution),
    createWorkspaceCompileTypstCommand(compileTypst),
    createWorkspaceCompileSvgCommand(compileSvg),
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
            const result = await runtimeOperations.executeRead({ code, target });
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
  const rank = (command: Command) => HELP_GROUPS.indexOf(helpGroupOf(command.name()));
  for (const command of [...commands].sort((left, right) => rank(left) - rank(right))) {
    configureOutput(command, output);
    command.helpGroup(helpGroupOf(command.name()));
    program.addCommand(command);
  }
  return program;
}

const HELP_GROUPS = ["Core commands:", "Content commands:", "Setup commands:"];
const CORE_COMMANDS = new Set([
  "auth",
  "repo",
  "issue",
  "label",
  "pr",
  "worktree",
  "search",
  "browse",
]);
const SETUP_COMMANDS = new Set(["config", "daemon", "skills", "resources", "api"]);

function helpGroupOf(name: string): string {
  if (CORE_COMMANDS.has(name)) return "Core commands:";
  return SETUP_COMMANDS.has(name) ? "Setup commands:" : "Content commands:";
}

function isRecord(value: unknown): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
