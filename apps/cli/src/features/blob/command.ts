import { Command } from "commander";
import type { WorkspaceBlobFeature } from "@univerjs/univer-workspace-client-core";
import { isForkAddress, workspaceError, type WorkspaceForkFeature } from "@univerjs/univer-workspace-client-core/product";
import { executeCommand, present, type JsonOption } from "../../command.js";

const FORK = ["--worktree <fork>", "a fork's owner/name: work on the upstream file through the fork"] as const;

function forkAddress(value: string | undefined): string | undefined {
  if (value === undefined || isForkAddress(value)) return value;
  throw workspaceError(
    "workspace-argument-invalid",
    "--worktree takes a fork's owner/name. A file changes only through a fork, as a draft its pull request publishes.",
  );
}

export function createBlobCommand(
  feature: WorkspaceBlobFeature,
  forks: Pick<WorkspaceForkFeature, "downloadBlob" | "replaceBlob">,
): Command {
  const root = new Command("blob").description("Transfer and replace Workspace Blob Resources");
  const upload = new Command("upload")
    .requiredOption("--file <source>")
    .requiredOption("--space <id>")
    .option("--parent <node>")
    .option("--name <name>")
    .option("--media-type <mime>")
    .option("--idempotency-key <key>")
    .option("--json")
    .action(
      async (
        options: JsonOption & {
          readonly file: string;
          readonly idempotencyKey?: string;
          readonly mediaType?: string;
          readonly name?: string;
          readonly parent?: string;
          readonly space: string;
        },
      ) => {
        const value = {
          upload: await executeCommand(
            upload,
            async () =>
              await feature.upload({
                filePath: options.file,
                spaceId: options.space,
                ...(options.parent === undefined ? {} : { parentNodeId: options.parent }),
                ...(options.name === undefined ? {} : { name: options.name }),
                ...(options.mediaType === undefined
                  ? {}
                  : { declaredMediaType: options.mediaType }),
                ...(options.idempotencyKey === undefined
                  ? {}
                  : { idempotencyKey: options.idempotencyKey }),
              }),
          ),
        };
        present(upload, options, value);
      },
    );
  const get = new Command("get")
    .argument("<resource>")
    .option("--json")
    .action(async (resourceId: string, options: JsonOption) => {
      present(get, options, await executeCommand(get, async () => await feature.get(resourceId)));
    });
  const download = new Command("download")
    .argument("<output>")
    .requiredOption("--resource <id>")
    .option("--force")
    .option(...FORK)
    .option("--json")
    .action(
      async (
        outputPath: string,
        options: JsonOption & { readonly force?: boolean; readonly resource: string; readonly worktree?: string },
      ) => {
        const value = {
          download: await executeCommand(download, async () => {
            const input = { outputPath, resourceId: options.resource, ...(options.force === true ? { force: true } : {}) };
            const fork = forkAddress(options.worktree);
            return fork === undefined ? await feature.download(input) : await forks.downloadBlob(fork, input);
          }),
        };
        present(download, options, value);
      },
    );
  const replace = new Command("replace")
    .description(
      "Replace Blob bytes immediately, preserving identity; requires the downloaded ETag. With --worktree, propose them as a draft its pull request's merge publishes",
    )
    .requiredOption("--resource <id>")
    .requiredOption("--file <source>")
    .requiredOption("--etag <etag>", "exact quoted strong ETag returned by download")
    .requiredOption("--idempotency-key <key>", "stable unique key for this replacement")
    .option(...FORK)
    .option("--json")
    .action(
      async (
        options: JsonOption & {
          readonly resource: string;
          readonly file: string;
          readonly etag: string;
          readonly idempotencyKey: string;
          readonly worktree?: string;
        },
      ) => {
        const input = { resourceId: options.resource, filePath: options.file, etag: options.etag, idempotencyKey: options.idempotencyKey };
        const value = await executeCommand(replace, async () => {
          const fork = forkAddress(options.worktree);
          return fork === undefined
            ? { replacement: await feature.replace(input) }
            : { draft: (await forks.replaceBlob(fork, input)).draft };
        });
        present(replace, options, value);
      },
    );
  return root.addCommand(upload).addCommand(get).addCommand(download).addCommand(replace);
}
