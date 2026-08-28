import { Command } from "commander";
import type { WorkspaceBlobFeature } from "@univerjs/univer-workspace-client-core";
import { executeCommand, present, type JsonOption } from "../../command.js";

export function createBlobCommand(feature: WorkspaceBlobFeature): Command {
  const root = new Command("blob").description("Transfer Workspace Blob Resources");
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
    .option("--json")
    .action(
      async (
        outputPath: string,
        options: JsonOption & { readonly force?: boolean; readonly resource: string },
      ) => {
        const value = {
          download: await executeCommand(
            download,
            async () =>
              await feature.download({
                outputPath,
                resourceId: options.resource,
                ...(options.force === true ? { force: true } : {}),
              }),
          ),
        };
        present(download, options, value);
      },
    );
  return root.addCommand(upload).addCommand(get).addCommand(download);
}
