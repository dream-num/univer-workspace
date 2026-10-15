import { UniverThreadCommentDataSourcePlugin } from "@univerjs-pro/thread-comment-datasource";
import type { IPresetPlugin } from "@univerjs/presets";

/**
 * Browser-side remote body integration; anchors remain Collaboration resources.
 * Comments are Unit-level conversation, not versioned content, so every
 * collaboration scope (trunk, worktree, merge preview) registers the same
 * plugins. See docs/application-design.md, "评论与 Worktree".
 */
export function getThreadCommentCollaborationPlugins(
  unitUiPlugin?: IPresetPlugin
): IPresetPlugin[] {
  return [
    ...(unitUiPlugin ? [unitUiPlugin] : []),
    UniverThreadCommentDataSourcePlugin,
  ];
}
