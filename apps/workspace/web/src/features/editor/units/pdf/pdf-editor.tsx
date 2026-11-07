import { UniverPdfsPlugin } from "@univerjs-pro/pdfs";
import { UniverPdfEditorPlugin } from "@univerjs-pro/pdfs-editor";
import { UniverPdfsExchangeClientPlugin } from "@univerjs-pro/pdfs-exchange-client";
import { UniverPdfsPrintPlugin } from "@univerjs-pro/pdfs-print";
import PdfsPrintEnUS from "@univerjs-pro/pdfs-print/locale/en-US";
import PdfsPrintZhCN from "@univerjs-pro/pdfs-print/locale/zh-CN";
import { UniverPdfsUIPlugin } from "@univerjs-pro/pdfs-ui";
import PdfsUIEnUS from "@univerjs-pro/pdfs-ui/locale/en-US";
import PdfsUIZhCN from "@univerjs-pro/pdfs-ui/locale/zh-CN";
import type { ILanguagePack } from "@univerjs/core";
import UniverDesignEnUS from "@univerjs/design/locale/en-US";
import UniverDesignZhCN from "@univerjs/design/locale/zh-CN";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsUIPlugin } from "@univerjs/docs-ui";
import UniverDocsUIEnUS from "@univerjs/docs-ui/locale/en-US";
import UniverDocsUIZhCN from "@univerjs/docs-ui/locale/zh-CN";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { mergeLocales, type IPreset } from "@univerjs/presets";
import { defaultTheme } from "@univerjs/themes";
import { UniverUIPlugin } from "@univerjs/ui";
import UniverUIEnUS from "@univerjs/ui/locale/en-US";
import UniverUIZhCN from "@univerjs/ui/locale/zh-CN";

import "@univerjs-pro/pdfs/facade";
import "@univerjs-pro/pdfs-exchange-client/facade";
import "@univerjs/design/lib/index.css";
import "@univerjs/ui/lib/index.css";
import "@univerjs/docs-ui/lib/index.css";
import "@univerjs-pro/pdfs-ui/lib/index.css";
import "@univerjs-pro/pdfs-print/lib/index.css";

import {
  createCollaborationEditor,
  type CollaborationEditorProps,
  type ICollaborationEditorDefinition,
} from "../../collaboration-editor";
import { createWorkspaceImportExportFeature } from "../../features/import-export";

export type PdfEditorProps = CollaborationEditorProps;

export const pdfEditorLocales: Readonly<
  Record<"zh-CN" | "en-US", ILanguagePack>
> = {
  "zh-CN": mergeLocales(
    UniverDesignZhCN,
    UniverUIZhCN,
    UniverDocsUIZhCN,
    PdfsUIZhCN,
    PdfsPrintZhCN
  ),
  "en-US": mergeLocales(
    UniverDesignEnUS,
    UniverUIEnUS,
    UniverDocsUIEnUS,
    PdfsUIEnUS,
    PdfsPrintEnUS
  ),
};

/**
 * PDF editor composition, modeled on univer-pro examples/src/pdfs/collaboration.
 * Docs UI provides the text editing surface the PDF editor embeds; the SDK's
 * page-thumbnail worker entry is not part of the published 1.3.1 package, so
 * thumbnails render on the main thread. PDF file import/export goes through
 * the Workspace exchange feature and the server's PDF conversion adapter.
 */
export function createPdfPresets(
  container: HTMLElement,
  compact = false
): IPreset[] {
  return [
    {
      plugins: [
        UniverRenderEnginePlugin,
        [
          UniverUIPlugin,
          {
            container,
            ribbonType: "grid",
            footer: false,
            ...(compact
              ? { header: false, toolbar: false, disableAutoFocus: true }
              : {}),
          },
        ],
        UniverDocsPlugin,
        [UniverDocsUIPlugin, { footer: false }],
        UniverPdfsPlugin,
        UniverPdfsUIPlugin,
      ],
    },
  ];
}

/**
 * PDF Units have no edit-history UI in SDK 1.3.1, so `history` stays unset.
 */
export const pdfEditorDefinition: ICollaborationEditorDefinition = {
  label: "pdf",
  theme: defaultTheme,
  enableDocumentCollaborationUI: false,
  locales: pdfEditorLocales,
  // The PDF editor lifecycle plugin depends on the Collaboration plugin and
  // would otherwise register its own copy ahead of the editor's; feature
  // plugins are registered right after the collaboration plugins.
  collaborationFeaturePlugins: () => [UniverPdfEditorPlugin],
  exchangeFeaturePlugins: () => [
    UniverPdfsExchangeClientPlugin,
    createWorkspaceImportExportFeature("pdf", { mobile: false }),
  ],
  printFeaturePlugins: () => [UniverPdfsPrintPlugin],
  createPresets: (container, _license, _collaborationScope, compact) =>
    createPdfPresets(container, compact),
  load: (univerAPI, unitId) =>
    univerAPI.getCollaboration().loadPdfAsync(unitId),
};

export default createCollaborationEditor(pdfEditorDefinition);
