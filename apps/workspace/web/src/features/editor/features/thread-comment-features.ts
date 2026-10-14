import { UniverThreadCommentDataSourcePlugin } from "@univerjs-pro/thread-comment-datasource";
import type { IPresetPlugin } from "@univerjs/presets";

/**
 * Comment UI in every view; remote body writes only on trunk. Unit presets
 * register models independently so Worktree replay/export retain their anchors.
 * Some presets already supply UI; those callers omit unitUiPlugin.
 */
export function getThreadCommentUiAndDataSourcePlugins(
  enableRemoteWrites = true,
  unitUiPlugin?: IPresetPlugin
): IPresetPlugin[] {
  return [
    ...(unitUiPlugin ? [unitUiPlugin] : []),
    ...(enableRemoteWrites ? [UniverThreadCommentDataSourcePlugin] : []),
  ];
}
