import { Command } from "commander";
import { executeCommand, present, type JsonOption } from "../../command.js";
import type { WorkspaceHtmlViewFeature } from "./html-view.js";

export function createHtmlViewCommand(
  feature: Pick<WorkspaceHtmlViewFeature, "validate" | "create">,
): Command {
  const root = new Command("html-view").description(
    "Validate and publish live .univer.html pages; see skills get html-view",
  );
  const validate = new Command("validate")
    .description(
      "Check declarative bindings against trunk Sheet sources; does not execute JavaScript",
    )
    .requiredOption("--file <source>", "local .univer.html file")
    .option("--json")
    .action(async (options: JsonOption & { readonly file: string }) => {
      present(
        validate,
        options,
        await executeCommand(validate, () => feature.validate(options.file)),
      );
    });
  const create = new Command("create")
    .description("Validate then publish a new Blob immediately, without a Unit Worktree")
    .requiredOption("--file <source>", "local .univer.html file")
    .requiredOption("--space <id>")
    .requiredOption("--name <name>", ".univer.html is appended if missing")
    .requiredOption("--idempotency-key <key>", "reuse only for identical content and destination")
    .option("--parent <node>")
    .option("--json")
    .action(
      async (
        options: JsonOption & {
          readonly file: string;
          readonly space: string;
          readonly name: string;
          readonly idempotencyKey: string;
          readonly parent?: string;
        },
      ) => {
        present(
          create,
          options,
          await executeCommand(create, () =>
            feature.create({
              filePath: options.file,
              spaceId: options.space,
              name: options.name,
              idempotencyKey: options.idempotencyKey,
              ...(options.parent === undefined ? {} : { parentNodeId: options.parent }),
            }),
          ),
        );
      },
    );
  return root.addCommand(validate).addCommand(create);
}
