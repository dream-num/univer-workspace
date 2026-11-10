import { readFile } from "node:fs/promises";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { htmlViewInput, htmlViewMaxBytes } from "../../../shared/executor-protocol.js";
import type { ToolContext } from "../definition.js";
import { stagingStore } from "./staging-support.js";

export const htmlViewSourceSchema = z.object({
  html: htmlViewInput.optional(),
  html_upload_id: z.string().min(1).optional(),
}).refine(
  (input) => (input.html === undefined) !== (input.html_upload_id === undefined),
  "Provide exactly one of html or html_upload_id.",
);

export async function readHtmlView(input: z.infer<typeof htmlViewSourceSchema>, context: ToolContext) {
  if (input.html !== undefined) return input.html;
  return stagingStore(context).withUpload(
    context.user.id,
    z.string().parse(input.html_upload_id),
    "html-view",
    async (object, path) => {
      if (object.size > htmlViewMaxBytes)
        throw workspaceError("workspace-argument-invalid", "HTML exceeds the 512 KiB UTF-8 limit.");
      const bytes = await readFile(path);
      let html: string;
      try {
        // Keep the BOM so re-encoding publishes the exact validated bytes.
        html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        throw workspaceError("workspace-argument-invalid", "HTML upload must be valid UTF-8.");
      }
      htmlViewInput.parse(html);
      context.usage?.addTransfer("upload_bytes", bytes.length);
      return html;
    },
  );
}
