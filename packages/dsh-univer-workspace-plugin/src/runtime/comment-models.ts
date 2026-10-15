import type { Univer } from "@univerjs/core";
import { UniverDocsThreadCommentPlugin } from "@univerjs/docs-thread-comment";
import { UniverBasesThreadCommentPlugin } from "@univerjs-pro/bases-thread-comment";
import { UniverBoardsThreadCommentPlugin } from "@univerjs-pro/boards-thread-comment";
import { UniverSlidesThreadCommentPlugin } from "@univerjs-pro/slides-thread-comment";

/**
 * SDK workaround for the headless worker. The `@univer-cli/headless-univer@1.0.3`
 * standard factory registers only the Sheet Thread Comment model. Without the
 * Doc, Slide, Base and Board models a loaded Unit drops its comment anchor
 * resource on the next save, so replay and export lose existing comments.
 * Register the missing models unconditionally, matching how the factory
 * registers every product plugin regardless of Unit type. No comment UI or
 * remote body datasource is installed here.
 *
 * REMOVE after upgrading to the SDK release that fixes
 * https://github.com/dream-num/univer-cli-sdk/issues/69 (factory registers all
 * five models): delete this module and its call in `worker.ts`. Keeping it on
 * a fixed SDK throws "duplicated plugin name" at worker startup. The browser
 * Viewer registers its models directly in `client/viewer/rendering.ts` and is
 * not affected by this removal.
 */
export function installCommentModelCompatibility(univer: Univer): void {
  univer.registerPlugin(UniverDocsThreadCommentPlugin);
  univer.registerPlugin(UniverSlidesThreadCommentPlugin);
  univer.registerPlugin(UniverBasesThreadCommentPlugin);
  univer.registerPlugin(UniverBoardsThreadCommentPlugin);
}
