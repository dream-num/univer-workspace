/**
 * Registration glue for the document tool groups.
 * @module dsh-univer-workspace-plugin/tools/documents
 */

import type { Context } from "@deepseek-ai/cordis";
import { registerDocumentCreationTools } from "./documents-creation.ts";
import { registerDocumentListTools } from "./documents-list.ts";
import { registerDocumentStatusTools } from "./documents-status.ts";

/** Register all document tools and return one lifecycle disposer. */
export function registerDocumentTools(ctx: Context): () => void {
  const disposers = [
    registerDocumentListTools(ctx),
    registerDocumentStatusTools(ctx),
    registerDocumentCreationTools(ctx),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
