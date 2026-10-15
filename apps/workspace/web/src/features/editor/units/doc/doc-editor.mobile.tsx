import { UniverDocsExchangeClientPlugin } from "@univerjs-pro/docs-exchange-client";

import {
  createCollaborationEditor,
  type CollaborationEditorProps,
} from "../../collaboration-editor";
import { createMobileExchangeFeaturePlugins } from "../../features/exchange-plugins";
import { docEditorDefinition } from "./doc-editor";
import { createDocMobilePresets } from "./doc-mobile-presets";

export type DocEditorProps = CollaborationEditorProps;

/**
 * History and print keep their desktop plugins: neither ships a Mobile
 * variant, and the official mobile Doc composition registers them as is.
 */
export default createCollaborationEditor({
  ...docEditorDefinition,
  mobile: true,
  // See createMobileExchangeFeaturePlugins.
  exchangeProvidedByPreset: true,
  exchangeFeaturePlugins: () =>
    createMobileExchangeFeaturePlugins([UniverDocsExchangeClientPlugin]),
  createPresets: (container, _license, _collaborationScope, compact) =>
    createDocMobilePresets({ container, compact }),
});
