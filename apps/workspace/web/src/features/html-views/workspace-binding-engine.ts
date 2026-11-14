import {
  createWorkspaceHtmlEngine,
  type TranslateHtmlViewWriteError,
} from "@univerjs/univer-workspace-html-viewer/engine";
import { UniverChartEmbedPlugin } from "@univerjs-pro/chart-embed";
import { UniverEmbedPlugin } from "@univerjs-pro/embed";
import { SnapshotService } from "@univerjs-pro/collaboration";
import { createWorkspaceReferencedUnitProviderRegistration } from "@univerjs/univer-workspace-reference-provider";
import { withWorkspaceSnapshotServerOverride, resolveUniverLicense } from "../editor";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export class HtmlViewSourceSheetRequiredError extends Error {}

export async function createWorkspaceBindingEngine(
  unitId: string,
  user: { id: string; displayName: string; avatarUrl?: string | null; anonymous?: boolean },
  signal: AbortSignal,
  translateError: TranslateHtmlViewWriteError,
  onTrialStarted?: () => void,
  draft = false,
) {
  signal.throwIfAborted();
  const resolved = await api.GET("/api/unit-resources/{unitId}", {
    params: { path: { unitId } },
    signal,
  });
  if (resolved.error) throw apiError(resolved.error);
  const opened = await api.POST("/api/resources/{resourceId}/open", {
    params: { path: { resourceId: resolved.data.resource.id } },
    signal,
  });
  if (opened.error) throw apiError(opened.error);
  const source = opened.data.resource;
  if (source.kind !== "univer" || source.unitType !== "sheet" || source.unitId !== unitId)
    throw new HtmlViewSourceSheetRequiredError();
  signal.throwIfAborted();
  return createWorkspaceHtmlEngine(
    {
      unitId,
      enableReadOnlyTrial: true,
      ...(onTrialStarted ? { onTrialStarted } : {}),
      translateError,
      canEdit: !draft && source.editorMode === "edit",
      user,
      license: resolveUniverLicense(),
      collaborationClientConfig: {
        snapshotServerUrl: "/universer-api/snapshot",
        collabSubmitChangesetUrl: "/universer-api/comb",
        collabWebSocketUrl: `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/universer-api/comb/connect`,
        wsSessionTicketUrl: "/universer-api/user/session-ticket",
        authzUrl: "/universer-api/authz",
        loginUrlKey: "/login",
        sendChangesetTimeout: 200,
        override: withWorkspaceSnapshotServerOverride(undefined, {
          hostScope: { kind: "trunk" },
          origin: location.origin,
          resolveMergePreview: async () => {
            throw new Error("HTML view sources only support trunk.");
          },
        }),
      },
      registerEmbed(univer) {
        univer.registerPlugin(UniverEmbedPlugin, {
          resourceRefUnitProviderRegistrations: [
            createWorkspaceReferencedUnitProviderRegistration({
              hostContext: { view: { kind: "trunk" }, mappedUnitIds: [unitId] },
              resolveSnapshotService: () => univer.__getInjector().get(SnapshotService),
            }),
          ],
        });
        // Referenced charts resolve through the embed runtime, so they must be
        // registered after UniverEmbedPlugin owns the referenced-Unit policy.
        univer.registerPlugin(UniverChartEmbedPlugin);
      },
    },
    signal,
  );
}
