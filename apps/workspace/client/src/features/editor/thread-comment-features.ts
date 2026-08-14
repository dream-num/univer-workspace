import { UniverThreadCommentDataSourcePlugin } from "@univerjs-pro/thread-comment-datasource";
import type { IPresetPlugin } from "@univerjs/presets";

/** Browser-side remote comment integration; the server uses Resource instead. */
export function getThreadCommentCollaborationPlugins(): IPresetPlugin[] {
  return [UniverThreadCommentDataSourcePlugin];
}
