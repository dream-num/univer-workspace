import {
  createWorkspaceHtmlEngine,
  type TranslateHtmlViewWriteError,
} from "@univerjs/univer-workspace-html-viewer/engine";
import { UniverChartEmbedPlugin } from "@univerjs-pro/chart-embed";
import { UniverEmbedPlugin } from "@univerjs-pro/embed";
import { UniverCollaborationEmbedPlugin } from "@univerjs-pro/collaboration-embed";
import { buildViewerUrls } from "../viewer/proxy.ts";
import type { ViewerBootstrap } from "../viewer-bootstrap.ts";
import { resolveHtmlViewSource } from "./source.ts";

export async function createAgentBindingEngine(
  unitId: string,
  bootstrap: ViewerBootstrap,
  signal: AbortSignal,
  translateError: TranslateHtmlViewWriteError,
) {
  const source = await resolveHtmlViewSource(unitId, signal);
  return createWorkspaceHtmlEngine(
    {
      unitId,
      translateError,
      canEdit: source.editorMode === "edit",
      user: bootstrap.user,
      license: bootstrap.license,
      collaborationClientConfig: {
        ...buildViewerUrls(),
        enableOfflineEditing: false,
        loginUrlKey: "/",
      },
      networkConfig: { useFetchImpl: true },
      registerEmbed(univer) {
        univer.registerPlugin(UniverEmbedPlugin);
        univer.registerPlugin(UniverCollaborationEmbedPlugin);
        // Keep the agent HTML view aligned with the workspace HTML view: the
        // referenced-chart runtime must follow UniverEmbedPlugin.
        univer.registerPlugin(UniverChartEmbedPlugin);
      },
    },
    signal,
  );
}
