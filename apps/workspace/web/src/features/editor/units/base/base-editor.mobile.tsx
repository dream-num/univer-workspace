import { UniverBasesExchangeClientPlugin } from "@univerjs-pro/bases-exchange-client";

import {
  createCollaborationEditor,
  type CollaborationEditorProps,
} from "../../collaboration-editor";
import { createMobileExchangeFeaturePlugins } from "../../features/exchange-plugins";
import { threadCommentComposition } from "../../features/thread-comments";
import { baseEditorDefinition } from "./base-editor";
import { createBaseMobilePresets } from "./base-mobile-presets";

export type BaseEditorProps = CollaborationEditorProps;

/** History keeps its desktop plugin; it has no Mobile variant. */
export default createCollaborationEditor({
  ...baseEditorDefinition,
  mobile: true,
  // See createMobileExchangeFeaturePlugins.
  exchangeProvidedByPreset: true,
  exchangeFeaturePlugins: () =>
    createMobileExchangeFeaturePlugins([UniverBasesExchangeClientPlugin]),
  createPresets: (container) => [
    ...createBaseMobilePresets(container),
    ...threadCommentComposition("base", "mobile").presets,
  ],
});
