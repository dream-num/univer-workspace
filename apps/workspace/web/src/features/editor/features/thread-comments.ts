import { UniverBasesThreadCommentPlugin } from "@univerjs-pro/bases-thread-comment";
import { UniverBasesThreadCommentUIPlugin } from "@univerjs-pro/bases-thread-comment-ui";
import { UniverBoardsThreadCommentPlugin } from "@univerjs-pro/boards-thread-comment";
import {
  UniverBoardsThreadCommentMobileUIPlugin,
  UniverBoardsThreadCommentUIPlugin,
} from "@univerjs-pro/boards-thread-comment-ui";
import { UniverSlidesThreadCommentPlugin } from "@univerjs-pro/slides-thread-comment";
import {
  UniverSlidesThreadCommentMobileUIPlugin,
  UniverSlidesThreadCommentUIPlugin,
} from "@univerjs-pro/slides-thread-comment-ui";
import { UniverThreadCommentDataSourcePlugin } from "@univerjs-pro/thread-comment-datasource";
import { UniverDocsThreadCommentPlugin } from "@univerjs/docs-thread-comment";
import { UniverDocsThreadCommentMobileUIPlugin } from "@univerjs/docs-thread-comment-ui";
import { UniverDocsThreadCommentPreset } from "@univerjs/preset-docs-thread-comment";
import { UniverSheetsThreadCommentPreset } from "@univerjs/preset-sheets-thread-comment";
import type { IPreset, IPresetPlugin } from "@univerjs/presets";
import { UniverSheetsThreadCommentPlugin } from "@univerjs/sheets-thread-comment";
import { UniverSheetsThreadCommentMobileUIPlugin } from "@univerjs/sheets-thread-comment-ui";
import { UniverThreadCommentMobileUIPlugin } from "@univerjs/thread-comment-ui";
import { UniverWorkspaceDocsThreadCommentDataSourcePlugin } from "../workarounds/doc-thread-comment-delete";

/**
 * Thread Comment composition for every Browser Univer runtime.
 *
 * Comments have three layers (docs/application-design.md, "评论与 Worktree"):
 * the anchor model, which every runtime that can save a Unit must register so
 * the anchor resource survives; the UI; and the remote body datasource, which
 * depends on the collaboration client and therefore registers after it. Every
 * collaboration scope (trunk, worktree, merge preview) gets the same
 * composition. Comparison panes and embedded products register the model only.
 */
export type ThreadCommentUnit = "sheet" | "doc" | "slide" | "base" | "board";
export type ThreadCommentVariant = "desktop" | "mobile" | "comparison";

export interface ThreadCommentComposition {
  /** Appended to the Unit presets: the anchor model, plus UI unless comparison. */
  readonly presets: readonly IPreset[];
  /** Registered after the collaboration client: the remote body datasource. */
  readonly collaborationPlugins: readonly IPresetPlugin[];
}

const MODEL: Record<ThreadCommentUnit, IPresetPlugin> = {
  sheet: UniverSheetsThreadCommentPlugin,
  doc: UniverDocsThreadCommentPlugin,
  slide: UniverSlidesThreadCommentPlugin,
  base: UniverBasesThreadCommentPlugin,
  board: UniverBoardsThreadCommentPlugin,
};

/** Model first, then UI: UI plugins depend on their model and must not register it implicitly. */
const DESKTOP: Record<ThreadCommentUnit, () => IPreset[]> = {
  // The official Sheet preset registers the model itself.
  sheet: () => [UniverSheetsThreadCommentPreset()],
  doc: () => [{ plugins: [MODEL.doc] }, UniverDocsThreadCommentPreset()],
  slide: () => [{ plugins: [MODEL.slide, UniverSlidesThreadCommentUIPlugin] }],
  base: () => [{ plugins: [MODEL.base, UniverBasesThreadCommentUIPlugin] }],
  board: () => [{ plugins: [MODEL.board, UniverBoardsThreadCommentUIPlugin] }],
};

// Mobile UI shares plugin names with the desktop UI, so it registers after the
// Unit's mobile presets and before anything that depends on comment UI.
const MOBILE: Record<ThreadCommentUnit, () => IPreset[]> = {
  sheet: () => [
    {
      plugins: [
        MODEL.sheet,
        UniverThreadCommentMobileUIPlugin,
        UniverSheetsThreadCommentMobileUIPlugin,
      ],
    },
  ],
  doc: () => [
    {
      plugins: [
        MODEL.doc,
        UniverThreadCommentMobileUIPlugin,
        UniverDocsThreadCommentMobileUIPlugin,
      ],
    },
  ],
  slide: () => [
    {
      plugins: [
        MODEL.slide,
        UniverThreadCommentMobileUIPlugin,
        UniverSlidesThreadCommentMobileUIPlugin,
      ],
    },
  ],
  // bases-thread-comment-ui has no Mobile variant; the touch base UI satisfies its dependency.
  base: () => [
    { plugins: [MODEL.base, UniverThreadCommentMobileUIPlugin, UniverBasesThreadCommentUIPlugin] },
  ],
  board: () => [
    {
      plugins: [
        MODEL.board,
        UniverThreadCommentMobileUIPlugin,
        UniverBoardsThreadCommentMobileUIPlugin,
      ],
    },
  ],
};

export function threadCommentComposition(
  unit: ThreadCommentUnit,
  variant: ThreadCommentVariant,
): ThreadCommentComposition {
  if (variant === "comparison") {
    return { presets: [{ plugins: [MODEL[unit]] }], collaborationPlugins: [] };
  }
  return {
    presets: (variant === "mobile" ? MOBILE : DESKTOP)[unit](),
    collaborationPlugins: [
      // Doc carries the isolated deletion workaround; see workarounds/.
      unit === "doc"
        ? UniverWorkspaceDocsThreadCommentDataSourcePlugin
        : UniverThreadCommentDataSourcePlugin,
    ],
  };
}
