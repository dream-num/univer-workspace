
import {
  createCollaborationEditor,
  type CollaborationEditorProps,
} from "../../collaboration-editor";
import { threadCommentComposition } from "../../features/thread-comments";
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
  createPresets: (container) => [
    ...createBoardMobilePresets(container),
    ...threadCommentComposition("board", "mobile").presets,
  ],
});
