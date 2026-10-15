import { UniverSlidesExchangeClientPlugin } from "@univerjs-pro/slides-exchange-client";
import { UniverSlidesPrintMobileUIPlugin } from "@univerjs-pro/slides-print";
import { UniverSlidesThreadCommentMobileUIPlugin } from "@univerjs-pro/slides-thread-comment-ui";

import {
  createCollaborationEditor,
  type CollaborationEditorProps,
} from "../../collaboration-editor";
import { createMobileExchangeFeaturePlugins } from "../../features/exchange-plugins";
import { getThreadCommentCollaborationPlugins } from "../../features/thread-comment-features";
import { slideEditorDefinition } from "./slide-editor";
import { createSlideMobilePresets } from "./slide-mobile-presets";

export type SlideEditorProps = CollaborationEditorProps;

/** History keeps its desktop plugin, as in the official mobile composition. */
export default createCollaborationEditor({
  ...slideEditorDefinition,
  mobile: true,
  collaborationFeaturePlugins: () =>
    getThreadCommentCollaborationPlugins(
      UniverSlidesThreadCommentMobileUIPlugin
    ),
  // See createMobileExchangeFeaturePlugins.
  exchangeProvidedByPreset: true,
  exchangeFeaturePlugins: () =>
    createMobileExchangeFeaturePlugins([UniverSlidesExchangeClientPlugin]),
  printFeaturePlugins: () => [UniverSlidesPrintMobileUIPlugin],
  createPresets: (container, _license, _scope, compact) =>
    createSlideMobilePresets({ container, compact }),
});
