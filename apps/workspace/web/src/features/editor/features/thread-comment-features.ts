import { UniverThreadCommentDataSourcePlugin } from "@univerjs-pro/thread-comment-datasource";
import type { IPresetPlugin } from "@univerjs/presets";

/**
 * Trunk-only comment UI and remote body integration. Unit presets register the
 * comment models independently so Worktree replay/export retain their anchors.
 * Some presets already supply UI; those callers omit unitUiPlugin.
 */
export function getThreadCommentUiAndDataSourcePlugins(
  enabled = true,
  unitUiPlugin?: IPresetPlugin
): IPresetPlugin[] {
  return enabled
    ? [
        ...(unitUiPlugin ? [unitUiPlugin] : []),
        UniverThreadCommentDataSourcePlugin,
      ]
    : [];
}
