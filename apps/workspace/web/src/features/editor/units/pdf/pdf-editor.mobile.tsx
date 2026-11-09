import { UniverPdfsExchangeClientPlugin } from "@univerjs-pro/pdfs-exchange-client";

import {
  createCollaborationEditor,
  type CollaborationEditorProps,
} from "../../collaboration-editor";
import { createWorkspaceImportExportFeature } from "../../features/import-export";
import { createPdfPresets, pdfEditorDefinition } from "./pdf-editor";

export type PdfEditorProps = CollaborationEditorProps;

/**
 * Touch variant of the PDF editor. SDK 1.3.1 ships no Mobile UI plugin for
 * PDF, so this keeps the desktop composition and only skips the desktop-only
 * Embed UI that the editor factory attaches to non-mobile editors.
 */
export default createCollaborationEditor({
  ...pdfEditorDefinition,
  mobile: true,
  exchangeFeaturePlugins: () => [
    UniverPdfsExchangeClientPlugin,
    createWorkspaceImportExportFeature("pdf", { mobile: true }),
  ],
  createPresets: (container) => createPdfPresets(container),
});
