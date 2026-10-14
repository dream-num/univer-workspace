import { UniverInstanceType, type Univer } from "@univerjs/core";
import { UniverDocsThreadCommentPlugin } from "@univerjs/docs-thread-comment";
import { UniverSheetsThreadCommentPlugin } from "@univerjs/sheets-thread-comment";
import { UniverSlidesThreadCommentPlugin } from "@univerjs-pro/slides-thread-comment";
import { UniverBasesThreadCommentPlugin } from "@univerjs-pro/bases-thread-comment";
import { UniverBoardsThreadCommentPlugin } from "@univerjs-pro/boards-thread-comment";

/** Persisted anchor models only; no comment UI or remote body datasource. */
export function registerCommentModels(univer: Univer): void {
  univer.registerPlugin(UniverSheetsThreadCommentPlugin);
  univer.registerPlugin(UniverDocsThreadCommentPlugin);
  univer.registerPlugin(UniverSlidesThreadCommentPlugin);
  univer.registerPlugin(UniverBasesThreadCommentPlugin);
  univer.registerPlugin(UniverBoardsThreadCommentPlugin);
}

/**
 * SDK 1.0.3's headless factory includes only Sheet comments. Remove this
 * compatibility registration once the factory passes the five-type resource
 * and replay regression on its own.
 */
export function installHeadlessCommentCompatibility(
  univer: Univer,
  unitType: UniverInstanceType,
): void {
  switch (unitType) {
    case UniverInstanceType.UNIVER_DOC:
      univer.registerPlugin(UniverDocsThreadCommentPlugin);
      break;
    case UniverInstanceType.UNIVER_SLIDE:
      univer.registerPlugin(UniverSlidesThreadCommentPlugin);
      break;
    case UniverInstanceType.UNIVER_BASE:
      univer.registerPlugin(UniverBasesThreadCommentPlugin);
      break;
    case UniverInstanceType.UNIVER_BOARD:
      univer.registerPlugin(UniverBoardsThreadCommentPlugin);
      break;
  }
}
