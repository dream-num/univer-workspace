import { IDEMPOTENCY_KEY_DESCRIPTION } from "../schemas.js";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { opSpecs } from "../../../shared/executor-protocol.js";
import { screenshotImage, screenshotOutput } from "../../../shared/screenshot-schema.js";
import { downloadSchema } from "../../staging/model.js";
import { readOnlyAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";
import { stagingStore } from "../files/staging-support.js";
import { worktreeInput } from "./space-support.js";

// Images up to this total come back as image content blocks; larger results as download links.
const INLINE_LIMIT_BYTES = 1024 * 1024;

const imageEntry = screenshotImage.omit({ offset: true });
const text = (what: string) => z.string().describe(what);

export const screenshotTool = executorTool({
  name: "screenshot",
  toolset: "core",
  scope: "read",
  title: "Screenshot a Unit",
  description:
    "Render a Unit from trunk or a Worktree as PNG images. Options are per Unit type: sheet takes range (and sheet), slide takes pages, contact_slide and tile, board takes elements or region (and padding, scale), doc and base take none. When the call finishes within the server's synchronous wait (30 seconds by default) and the images total at most 1 MiB, each PNG is returned as an image content block and structuredContent lists the images. Otherwise each image entry carries a private download link valid for 15 minutes, and a long render returns a job_id with status running; poll job_get until succeeded or failed. A result delivered through job_get always uses download links. Reuse idempotency_key with the same arguments on retry to avoid a second render; different arguments return workspace-idempotency-conflict.",
  annotations: readOnlyAnnotations,
  inputSchema: z.object({
    unit: z.string().min(1),
    trunk: z.boolean().optional(),
    worktree: worktreeInput.optional(),
    pages: text("Slide pages or page IDs, for example 1,3-5,cover, or all.").optional(),
    contact_slide: z
      .boolean()
      .describe("Slide only: one overview image containing all captured pages.")
      .optional(),
    tile: text("Slide contact slide grid as <columns>x<rows>, for example 4x2.").optional(),
    sheet: text("Sheet name used with range.").optional(),
    range: text("Sheet range in A1 notation, for example B2:H40.").optional(),
    region: text("Board region as left,top,width,height.").optional(),
    elements: text("Board element IDs separated by commas.").optional(),
    padding: z.number().describe("Board content padding in pixels.").optional(),
    scale: z.number().describe("Board selector scale between 0.1 and 4.").optional(),
    idempotency_key: opSpecs["exchange.import"].input.shape.idempotencyKey.optional().describe(IDEMPOTENCY_KEY_DESCRIPTION),
  }),
  outputSchema: screenshotOutput.extend({
    images: z.array(imageEntry.extend({ download: downloadSchema.optional() })),
  }),
  op: opSpecs["render.screenshot"],
  job: { tool: "screenshot", key: (args) => args.idempotency_key },
  request: ({ unit, trunk, worktree, contact_slide, idempotency_key: _key, ...options }) => {
    if (trunk === true && worktree !== undefined)
      throw workspaceError(
        "workspace-argument-invalid",
        "trunk cannot be used together with worktree.",
      );
    if (trunk !== true && worktree === undefined)
      throw workspaceError(
        "workspace-screenshot-scope-required",
        "Workspace screenshot requires worktree or trunk: true.",
      );
    return {
      input: {
        unitId: unit,
        scope:
          worktree === undefined
            ? { kind: "trunk" as const }
            : { kind: "worktree" as const, worktreeId: worktree },
        options: {
          ...options,
          ...(contact_slide === undefined ? {} : { contactSlide: contact_slide }),
        },
      },
    };
  },
  // Every image is staged so a job that outlives its caller can still deliver links. The caller
  // that waits gets the images inline instead when they are small.
  async response({ output, bytes }, _args, context) {
    const store = stagingStore(context);
    const images = [];
    for (const { offset, ...image } of output.images) {
      const content = bytes.subarray(offset, offset + image.size);
      const download = await store.createDownload({
        owner: context.user.id,
        fileName: image.name,
        mediaType: image.mediaType,
        size: image.size,
        content: (async function* () {
          yield content;
        })(),
      });
      context.usage?.addTransfer("export_bytes", image.size);
      images.push({ entry: image, download, content });
    }
    const durable = {
      unitId: output.unitId,
      unitType: output.unitType,
      images: images.map(({ entry, download }) => ({ ...entry, download })),
    };
    return {
      output: durable,
      ...(bytes.length <= INLINE_LIMIT_BYTES
        ? {
            waiting: {
              output: { ...durable, images: images.map(({ entry }) => entry) },
              content: images.map(({ content }) => ({
                type: "image" as const,
                data: Buffer.from(content).toString("base64"),
                mimeType: "image/png",
              })),
            },
          }
        : {}),
    };
  },
});
