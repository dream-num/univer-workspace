import { UniverInstanceType, type Univer } from "@univerjs/core";
import { UniverDocsThreadCommentPlugin } from "@univerjs/docs-thread-comment";

/**
 * SDK 1.0.3's standard headless factory registers only the Sheet comment model.
 * Doc snapshots also need their resource hook and decoration mutation for replay
 * and export. Register the public model plugin before loading a remote Doc.
 * Remove when the upstream factory preserves Doc comment resources and replays
 * their decoration mutations in the regression test without this registration.
 */
export function installDocCommentReplayCompatibility(
  univer: Univer,
  unitType: UniverInstanceType,
): void {
  if (unitType === UniverInstanceType.UNIVER_DOC) {
    univer.registerPlugin(UniverDocsThreadCommentPlugin);
  }
}
