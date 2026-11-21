import {
  createWorkspaceHtmlEngine,
  type TranslateHtmlViewWriteError,
} from "@univerjs/univer-workspace-html-viewer/engine";
import { UniverChartEmbedPlugin } from "@univerjs-pro/chart-embed";
import { UniverEmbedPlugin } from "@univerjs-pro/embed";
import { SnapshotService } from "@univerjs-pro/collaboration";
import { createWorkspaceReferencedUnitProviderRegistration, type WorkspaceReferenceHostContext } from "@univerjs/univer-workspace-reference-provider";
import { withWorkspaceSnapshotServerOverride, resolveUniverLicense, resolveCollaborationConfig } from "../editor";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

import type { components } from "../../../../generated/http/schema";

export type HtmlViewSourceWorktree = Pick<components["schemas"]["WorktreeDetail"], "id" | "state" | "units">;

export class HtmlViewSourceSheetRequiredError extends Error {}

export async function createWorkspaceBindingEngine(
  unitId: string,
  user: { id: string; displayName: string; avatarUrl?: string | null; anonymous?: boolean },
  signal: AbortSignal,
  translateError: TranslateHtmlViewWriteError,
  onTrialStarted?: () => void,
  draft = false,
  sourceWorktree?: HtmlViewSourceWorktree,
) {
  signal.throwIfAborted();
  const worktree = draft && sourceWorktree?.state !== "merged" ? sourceWorktree : undefined;
  const mappedUnit = worktree?.units.find((unit) => unit.unitId === unitId);
  let canEdit = false;
  let scope: components["schemas"]["CollaborationScope"] = { kind: "trunk" };
  if (mappedUnit && worktree) {
    if (mappedUnit.unitType !== "sheet") throw new HtmlViewSourceSheetRequiredError();
    const opened = await api.POST("/api/worktrees/{worktreeId}/units/{unitId}/open", {
      params: { path: { worktreeId: worktree.id, unitId } },
      body: { mode: "draft" },
      signal,
    });
    if (opened.error) throw apiError(opened.error);
    if (opened.data.unit.unitType !== "sheet" || opened.data.unit.unitId !== unitId)
      throw new HtmlViewSourceSheetRequiredError();
    scope = opened.data.collaborationScope;
  } else {
    const resolved = await api.GET("/api/unit-resources/{unitId}", {
      params: { path: { unitId } }, signal,
    });
    if (resolved.error) throw apiError(resolved.error);
    const opened = await api.POST("/api/resources/{resourceId}/open", {
      params: { path: { resourceId: resolved.data.resource.id } }, signal,
    });
    if (opened.error) throw apiError(opened.error);
    const source = opened.data.resource;
    if (source.kind !== "univer" || source.unitType !== "sheet" || source.unitId !== unitId)
      throw new HtmlViewSourceSheetRequiredError();
    canEdit = !draft && source.editorMode === "edit";
  }
  const collaboration = await resolveCollaborationConfig(scope, unitId);
  const hostContext: WorkspaceReferenceHostContext = worktree
    ? { view: { kind: "worktree", worktreeId: worktree.id }, mappedUnitIds: worktree.units.map((unit) => unit.unitId) }
    : { view: { kind: "trunk" } };
  signal.throwIfAborted();
  return createWorkspaceHtmlEngine(
    {
      unitId,
      enableReadOnlyTrial: true,
      ...(onTrialStarted ? { onTrialStarted } : {}),
      translateError,
      canEdit,
      user,
      license: resolveUniverLicense(),
      collaborationClientConfig: {
        wsSessionTicketUrl: "/universer-api/user/session-ticket",
        authzUrl: "/universer-api/authz",
        ...collaboration.pluginConfig,
        loginUrlKey: "/login",
        sendChangesetTimeout: 200,
        override: withWorkspaceSnapshotServerOverride(collaboration.pluginConfig.override, {
          hostScope: collaboration.hostSnapshotScope,
          origin: location.origin,
          resolveMergePreview: async () => {
            throw new Error("HTML view sources do not use merge previews.");
          },
        }),
      },
      registerEmbed(univer) {
        univer.registerPlugin(UniverEmbedPlugin, {
          resourceRefUnitProviderRegistrations: [
            createWorkspaceReferencedUnitProviderRegistration({
              hostContext,
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
