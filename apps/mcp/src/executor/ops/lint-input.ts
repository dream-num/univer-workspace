import {
  createUnitLayoutLintCommand,
  type UnitLayoutLintCommandDependencies,
} from "@univer-cli/unit-layout-lint-command";
import type { UnitLayoutLintInput } from "@univer-cli/unit-layout-lint";
import { WorkspaceUnitLayoutLintFeature } from "@univerjs/univer-workspace-client-core";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { CommanderError } from "commander";
import type { Handler } from "../context.js";
import { renderUnitLoader } from "./scope.js";

type Ctx = Parameters<Handler<"render.lint">>[0];

/**
 * Builds the lint input by running the `uvw lint` command itself, so the page selector parsing,
 * the Slide-only check and their messages match the CLI. The command never lints: its lint
 * dependency only records the input it builds.
 */
export async function lintInput(
  ctx: Ctx,
  options: {
    readonly worktreeId: string;
    readonly unitId: string;
    readonly pages?: string | undefined;
  },
): Promise<UnitLayoutLintInput> {
  // Only loadUnit is used; the runtime options of the feature serve its own lint(), which is not called here.
  const feature = new WorkspaceUnitLayoutLintFeature({
    renderPageRoot: "",
    license: "",
    env: {},
    loader: renderUnitLoader(ctx),
  });
  let built: UnitLayoutLintInput | undefined;
  let loadError: unknown;
  const dependencies: UnitLayoutLintCommandDependencies = {
    loadUnit: ({ unitId }) =>
      feature
        .loadUnit({ scope: { kind: "worktree", worktreeId: options.worktreeId }, unitId })
        .catch((error: unknown) => {
          loadError = error;
          throw error;
        }),
    lint: {
      lint: async (input) => {
        built = input;
        return {
          kind: "unit-layout-lint",
          unitId: "",
          unitType: "slide",
          coverage: { pages: [], rules: [] },
          findings: [],
        };
      },
    },
  };
  const quiet = { writeOut: () => {}, writeErr: () => {}, outputError: () => {} };
  const command = createUnitLayoutLintCommand(dependencies).exitOverride().configureOutput(quiet);
  try {
    await command.parseAsync(
      [
        `--unit=${options.unitId}`,
        ...(options.pages === undefined ? [] : [`--pages=${options.pages}`]),
      ],
      { from: "user" },
    );
  } catch (error) {
    // The command flattens a load failure into `<code>: <message>`; rethrow the original instead.
    if (loadError !== undefined) throw loadError;
    if (error instanceof CommanderError)
      throw workspaceError("workspace-argument-invalid", error.message);
    throw error;
  }
  if (built === undefined) throw new Error("The lint command did not build an input.");
  return built;
}
