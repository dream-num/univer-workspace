import { UniverInstanceType, type Univer } from "@univerjs/core";
import { UniverDocsThreadCommentPlugin } from "@univerjs/docs-thread-comment";
import { UniverSlidesThreadCommentPlugin } from "@univerjs-pro/slides-thread-comment";
import { UniverBasesThreadCommentPlugin } from "@univerjs-pro/bases-thread-comment";
import { UniverBoardsThreadCommentPlugin } from "@univerjs-pro/boards-thread-comment";

/**
 * SDK 1.0.3's standard headless factory registers only the Sheet comment model.
 * Register the missing public models before loading remote Units so replay and
 * export retain their comment resources. No comment UI or remote body writer is
 * installed. Remove when the upstream factory passes the five-type comment
 * resource and replay regression without this registration.
 */
export function installCommentReplayCompatibility(
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
