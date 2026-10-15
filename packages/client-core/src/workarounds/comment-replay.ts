import type { Univer } from "@univerjs/core";
import { UniverDocsThreadCommentPlugin } from "@univerjs/docs-thread-comment";
import { UniverBasesThreadCommentPlugin } from "@univerjs-pro/bases-thread-comment";
import { UniverBoardsThreadCommentPlugin } from "@univerjs-pro/boards-thread-comment";
import { UniverSlidesThreadCommentPlugin } from "@univerjs-pro/slides-thread-comment";

/**
 * SDK workaround: the `@univer-cli/headless-univer@1.0.3` standard factory
 * registers only the Sheet Thread Comment model. Without the Doc, Slide, Base
 * and Board models a loaded Unit drops its comment anchor resource on the next
 * save, so replay and export lose existing comments. Register the missing
 * models unconditionally, matching how the factory registers every product
 * plugin regardless of Unit type. No comment UI or remote body datasource is
 * installed here. Remove once the upstream factory registers all five models
 * (https://github.com/dream-num/univer-cli-sdk/issues/69).
 */
export function installCommentReplayCompatibility(univer: Univer): void {
  univer.registerPlugin(UniverDocsThreadCommentPlugin);
  univer.registerPlugin(UniverSlidesThreadCommentPlugin);
  univer.registerPlugin(UniverBasesThreadCommentPlugin);
  univer.registerPlugin(UniverBoardsThreadCommentPlugin);
}
