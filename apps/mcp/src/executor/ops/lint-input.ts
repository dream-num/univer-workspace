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
  const dependencies: UnitLayoutLintCommandDependencies = {
    loadUnit: ({ unitId }) =>
      feature.loadUnit({ scope: { kind: "worktree", worktreeId: options.worktreeId }, unitId }),
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
    if (error instanceof CommanderError) {
      // The command renders an application error as `<code>: <message>`; keep its code.
      const coded = /^(workspace-[a-z0-9-]+): ([\s\S]*)$/.exec(error.message);
      throw coded?.[1] !== undefined && coded[2] !== undefined
        ? workspaceError(coded[1], coded[2])
        : workspaceError("workspace-argument-invalid", error.message);
    }
    throw error;
  }
  if (built === undefined) throw new Error("The lint command did not build an input.");
  return built;
}
