import { UniverThreadCommentDataSourcePlugin } from "@univerjs-pro/thread-comment-datasource";
import type { IPresetPlugin } from "@univerjs/presets";

/** Browser-side remote body integration; anchors remain Collaboration resources. */
export function getThreadCommentCollaborationPlugins(
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
