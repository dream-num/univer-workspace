import {
  createUnitScreenshotCommand,
  type UnitScreenshotCommandDependencies,
} from "@univer-cli/unit-screenshot-command";
import type { UnitScreenshotInput } from "@univer-cli/unit-screenshot";
import type { UniverRenderUnit } from "@univer-cli/univer-render-runtime";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { CommanderError } from "commander";
import type { z } from "zod";
import type { screenshotOptions } from "../../shared/executor-protocol.js";

type Options = z.output<typeof screenshotOptions>;

/**
 * Maps the tool's options to the upstream screenshot target by running the `uvw screenshot`
 * command itself, so flag parsing and its rejections match the CLI. The command never captures
 * or writes: its dependencies only record the input it builds.
 */
export async function screenshotTarget(
  unit: UniverRenderUnit,
  options: Options,
): Promise<UnitScreenshotInput["target"]> {
  let built: UnitScreenshotInput | undefined;
  const dependencies: UnitScreenshotCommandDependencies = {
    loadUnit: async () => unit,
    screenshot: {
      capture: async (input) => {
        built = input;
        return { unitId: "", unitType: unit.unitType, images: [] };
      },
    },
    writeImages: async () => [],
  };
  const quiet = { writeOut: () => {}, writeErr: () => {}, outputError: () => {} };
  const command = createUnitScreenshotCommand(dependencies).exitOverride().configureOutput(quiet);
  const flags = Object.entries({
    pages: options.pages,
    tile: options.tile,
    sheet: options.sheet,
    range: options.range,
    region: options.region,
    elements: options.elements,
    padding: options.padding,
    scale: options.scale,
  }).flatMap(([name, value]) => (value === undefined ? [] : [`--${name}=${String(value)}`]));
  if (options.contactSlide === true) flags.push("--contact-slide");
  try {
    await command.parseAsync(flags, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError)
      throw workspaceError("workspace-argument-invalid", error.message);
    throw error;
  }
  if (built === undefined) throw new Error("The screenshot command did not build an input.");
  return built.target;
}
