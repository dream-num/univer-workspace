import { UniverBoardsThreadCommentMobileUIPlugin } from "@univerjs-pro/boards-thread-comment-ui";

import {
  createCollaborationEditor,
  type CollaborationEditorProps,
} from "../../collaboration-editor";
import { getThreadCommentCollaborationPlugins } from "../../features/thread-comment-features";
import { boardEditorDefinition } from "./board-editor";
import { createBoardMobilePresets } from "./board-mobile-presets";

export type BoardEditorProps = CollaborationEditorProps;

/**
 * History and print keep their desktop plugins: neither ships a Mobile
 * variant, and the official mobile Board composition registers them as is.
 */
export default createCollaborationEditor({
  ...boardEditorDefinition,
  mobile: true,
  collaborationFeaturePlugins: () =>
    getThreadCommentCollaborationPlugins(
      UniverBoardsThreadCommentMobileUIPlugin
    ),
  createPresets: (container) => createBoardMobilePresets(container),
});
