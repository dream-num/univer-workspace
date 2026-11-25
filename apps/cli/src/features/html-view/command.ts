import { Command } from "commander";
import { isForkAddress, workspaceError, type WorkspaceForkFeature } from "@univerjs/univer-workspace-client-core/product";
import { executeCommand, present, type JsonOption } from "../../command.js";
import type { RepoContext } from "../../repo-context.js";
import type { WorkspaceHtmlViewFeature } from "./html-view.js";

export function createHtmlViewCommand(
  feature: Pick<WorkspaceHtmlViewFeature, "validate" | "create">,
  forks: Pick<WorkspaceForkFeature, "readWorktree">,
  context: Pick<RepoContext, "repoOrFork">,
): Command {
  const root = new Command("html-view").description(
    "Validate and publish live .univer.html pages; see skills get html-view",
  );
  const validate = new Command("validate")
    .description(
      "Check declarative bindings against Sheet sources; does not execute JavaScript",
    )
    .requiredOption("--file <source>", "local .univer.html file")
    .option("--worktree <id>", "read mapped sources from this pull request, or from a fork's owner/name")
    .option("--json")
    .action(async (options: JsonOption & { readonly file: string; readonly worktree?: string }) => {
      present(
        validate,
        options,
        await executeCommand(validate, async () => {
          const worktree = options.worktree === undefined || !isForkAddress(options.worktree)
            ? options.worktree
            : (await forks.readWorktree(options.worktree))?.id;
          return await feature.validate(options.file, worktree);
        }),
      );
    });
  const create = new Command("create")
    .description("Validate then publish a new Blob immediately, without a Unit Worktree")
    .requiredOption("--file <source>", "local .univer.html file")
    .requiredOption("--space <repo>", "owner/slug, unique bare slug from repo list, Space ID or URL")
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
          await executeCommand(create, async () => {
            const resolved = await context.repoOrFork(options.space);
            if ("fork" in resolved) {
              const { fork } = resolved;
              throw workspaceError(
                "workspace-argument-invalid",
                `${fork.fullName} is a fork of ${fork.upstream?.fullName ?? fork.upstream?.id ?? "its upstream"}. html-view create publishes to a repository's trunk at once, and the CLI saves no page drafts, so it cannot propose a page through a fork. Save the page through the fork with the MCP tool html_view_save and worktree ${fork.fullName}.`,
                { fork: fork.fullName },
              );
            }
            return await feature.create({
              filePath: options.file,
              spaceId: resolved.spaceId,
              name: options.name,
              idempotencyKey: options.idempotencyKey,
              ...(options.parent === undefined ? {} : { parentNodeId: options.parent }),
            });
          }),
        );
      },
    );
  return root.addCommand(validate).addCommand(create);
}
