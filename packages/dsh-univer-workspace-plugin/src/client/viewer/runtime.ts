/** Direct React-mounted Univer Viewer runtime.
 *
 * This module is the target-side equivalent of dsh-univer-office's
 * `viewer-app/core/viewer.ts`. The Univer SDK composition is explicit: no
 * preset silently adds a second exchange/collaboration plugin, and the only
 * target-specific seam is the opaque same-origin URL set built by `proxy.ts`.
 */

import { FUniver } from "@univerjs/core/facade";
import "@univerjs-pro/collaboration-client/facade";
import {
  IAuthzIoService,
  ICommandService,
  IPermissionService,
  IUndoRedoService,
  IUniverInstanceService,
  Univer,
  UniverInstanceType,
  UserManagerService,
} from "@univerjs/core";
import type { IUser } from "@univerjs/protocol";
import {
  EmbedModelService,
  EmbedReferencedUnitMaterializeService,
  IReferencedUnitManagerService,
} from "@univerjs-pro/embed";
import {
  FormulaCalculationSessionService,
  SetTriggerFormulaCalculationStartMutation,
  type ISetFormulaCalculationResultMutation,
} from "@univerjs/engine-formula";
import { UniverCollaborationPlugin } from "@univerjs-pro/collaboration";
import { UniverCollaborationClientPlugin } from "@univerjs-pro/collaboration-client";
import {
  BrowserCollaborationSocketService,
  UniverCollaborationClientUIPlugin,
} from "@univerjs-pro/collaboration-client-ui";
import { UniverCollaborationEmbedPlugin } from "@univerjs-pro/collaboration-embed";
import { UniverEditHistoryLoaderPlugin } from "@univerjs-pro/edit-history-loader";
import type { LocaleType } from "@univerjs/core";
import { ensureViewerStyles } from "../viewer-css.ts";
import { isViewerUnitTypeSupported } from "../viewer-types.ts";
import { localeKeyOf, LOCALE_PACKS } from "./locales.ts";
import {
  blockLocalEditingCommands,
  enforceSheetViewerReadOnlyPermissions,
  READ_ONLY_COPY,
  resolveViewerReadOnlyEnforcement,
  withReadOnlyPermissionLocale,
} from "./readonly.ts";
import { installHistoryShapeFormulaCompatibility } from "./history-compatibility.ts";
import { ViewAssetIoOwner, registerViewerRendering } from "./rendering.ts";
import { createSheetResourceRefDataProvider } from "./resource-ref.ts";
import { buildViewerUrls, loadViewerMergePreviewConfig } from "./proxy.ts";
import type { ViewerHandle, ViewerOptions } from "./contracts.ts";

// The history viewer creates a nested Univer composition. Install its formula
// dependency compatibility before any runtime is constructed.
installHistoryShapeFormulaCompatibility();

/** Mount one trunk or editable Worktree Unit through the collaboration client. */
export async function createViewerRuntime(opts: ViewerOptions): Promise<ViewerHandle> {
  if (!isViewerUnitTypeSupported(opts.unitType)) {
    throw new Error(
      `Unsupported embedded Viewer Unit type: ${opts.unitType}; supported types: sheet, doc, slide, base, board`,
    );
  }

  // Office keeps the original edits visible when a ready Worktree cannot
  // materialize a merge preview (for example, there are no changesets to
  // replay). Never blank the Viewer in that case: fall back to the Worktree
  // stream, read-only, while the surrounding status remains "待确认".
  let scope = opts.scope;
  if (opts.scope.kind === "mergePreview") {
    try {
      await loadViewerMergePreviewConfig(opts.scope.worktreeId, opts.unitId);
      // The current embedded runtime has no snapshot-replay adapter yet. The
      // successful evaluator result is therefore still rendered from the
      // canonical Worktree stream until that adapter is available.
    } catch {
      // Same fallback for evaluator errors (conflict, no changesets, etc.).
    }
    scope = { kind: "worktree", worktreeId: opts.scope.worktreeId };
  }

  const editable = opts.editable === true;
  const localeKey = localeKeyOf(opts.locale);
  const localePack = editable
    ? LOCALE_PACKS[localeKey]
    : withReadOnlyPermissionLocale(LOCALE_PACKS[localeKey], READ_ONLY_COPY[localeKey]);
  const worktreeId = scope.kind === "worktree" ? scope.worktreeId : undefined;
  const urls = buildViewerUrls(worktreeId);
  const releaseViewerStyles = ensureViewerStyles();

  const univer = new Univer({
    locale: opts.locale,
    locales: { [opts.locale]: localePack },
    darkMode: opts.darkMode === true,
    // Collaboration supplies authz and collaborative undo/redo. Nulling the
    // core implementations avoids duplicate Redi registrations.
    override: [
      [IAuthzIoService, null],
      [IUndoRedoService, null],
    ] as never,
  });

  const sheetResourceRefDataProvider = createSheetResourceRefDataProvider(() => {
    const injector = univer.__getInjector();
    return {
      referencedUnitManager: injector.get(IReferencedUnitManagerService),
      univerInstanceService: injector.get(IUniverInstanceService),
      waitForFormulaResultApplied: () =>
        injector.get(FormulaCalculationSessionService).waitForLatestApplied(),
      executeFormulaCalculation: () => {
        void injector.get(ICommandService).executeCommand(
          SetTriggerFormulaCalculationStartMutation.id,
          { commands: [], forceCalculation: true },
          { onlyLocal: true },
        );
      },
    };
  });

  let disposed = false;
  let formulaResultAppliedSubscription: { unsubscribe(): void } | undefined;
  let api: ReturnType<typeof FUniver.newAPI> | undefined;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    formulaResultAppliedSubscription?.unsubscribe();
    formulaResultAppliedSubscription = undefined;
    sheetResourceRefDataProvider.dispose();
    if (window.univer === univer) delete window.univer;
    if (api !== undefined && window.univerAPI === api) delete window.univerAPI;
    try {
      api?.dispose();
    } finally {
      try {
        univer.dispose();
      } finally {
        releaseViewerStyles();
      }
    }
  };

  try {
    registerViewerRendering(univer, {
      container: opts.container,
      assetIoOwner: ViewAssetIoOwner.CollaborationClient,
      license: opts.license,
      workbenchChrome: opts.unitType === "board" ? "hidden" : "visible",
      ribbonType: "grid",
      unitType: toUniverInstanceType(opts.unitType),
      ...(scope.kind === "trunk" && opts.unitType !== "board"
        ? {
            exchangeClientConfig: {
              uploadFileServerUrl: urls.uploadFileServerUrl,
              getTaskServerUrl: urls.getTaskServerUrl,
              signUrlServerUrl: urls.signUrlServerUrl,
              importServerUrl: urls.importServerUrl,
              exportServerUrl: urls.exportServerUrl,
              downloadEndpointUrl: urls.downloadEndpointUrl,
            },
          }
        : {}),
      resourceRefDataProviderRegistrations: [sheetResourceRefDataProvider.registration],
      registerBeforeEmbedCore: () => {
        univer.registerPlugin(UniverCollaborationPlugin);
        univer.registerPlugin(UniverCollaborationClientPlugin, {
          socketService: BrowserCollaborationSocketService,
          enableOfflineEditing: false,
          enableAuthServer: true,
          enableSingleActiveInstanceLock: false,
          // Harness owns OAuth at this route; this is the client redirect only.
          loginUrlKey: "/auth/login",
          sendChangesetTimeout: 200,
          ...urls,
        });
        univer.registerPlugin(
          UniverCollaborationClientUIPlugin,
          opts.unitType === "base" ? { enableDocumentCollaborationUI: false } : {},
        );
        if (opts.unitType === "sheet" && scope.kind === "trunk") {
          univer.registerPlugin(UniverEditHistoryLoaderPlugin, {
            historyListServerUrl: urls.snapshotServerUrl.replace(/\/snapshot$/u, "/history"),
            univerContainerId: opts.container,
          });
        }
      },
      registerAfterEmbedCore: () => {
        univer.registerPlugin(UniverCollaborationEmbedPlugin);
      },
    });

    api = FUniver.newAPI(univer);
    api.loadLocales(opts.locale, localePack);
    window.univer = univer;
    window.univerAPI = api;

    const protocolUser: IUser = {
      userID: opts.user.id,
      name: opts.user.displayName,
      avatar: opts.user.avatarUrl ?? "",
      anonymous: false,
      canBindAnonymous: false,
      phone: "",
      email: "",
      createTimestamp: 0,
    };
    univer.__getInjector().get(UserManagerService).setCurrentUser(protocolUser);

    formulaResultAppliedSubscription = univer
      .__getInjector()
      .get(FormulaCalculationSessionService)
      .resultApplied$
      .subscribe((result: ISetFormulaCalculationResultMutation) => {
        void sheetResourceRefDataProvider.formulaResultApplied(result);
      });

    await loadUnit(api.getCollaboration(), opts.unitType, opts.unitId);
    if (disposed) throw new Error("Viewer disposed while loading the Unit.");
    await materializeHostEmbedChildren(univer, opts.unitId);
    if (disposed) throw new Error("Viewer disposed while materializing embeds.");

    const readOnlyEnforcement = resolveViewerReadOnlyEnforcement(opts.unitType, editable);
    if (readOnlyEnforcement === "sheet-permission") {
      enforceSheetViewerReadOnlyPermissions(
        univer.__getInjector().get(IPermissionService),
        opts.unitId,
      );
    } else if (readOnlyEnforcement === "mutation-gate") {
      blockLocalEditingCommands(univer.__getInjector().get(ICommandService));
    }

    return {
      setDarkMode: (isDarkMode) => {
        if (!disposed) api?.toggleDarkMode(isDarkMode);
      },
      setLocale: async (locale: LocaleType) => {
        if (disposed) return;
        const packKey = localeKeyOf(locale);
        const pack = editable
          ? LOCALE_PACKS[packKey]
          : withReadOnlyPermissionLocale(LOCALE_PACKS[packKey], READ_ONLY_COPY[packKey]);
        api?.loadLocales(locale, pack);
        api?.setLocale(locale);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

async function loadUnit(
  collaboration: ReturnType<ReturnType<typeof FUniver.newAPI>["getCollaboration"]>,
  unitType: ViewerOptions["unitType"],
  unitId: string,
): Promise<void> {
  switch (unitType) {
    case "doc":
      await collaboration.loadDocAsync(unitId);
      return;
    case "slide":
      await collaboration.loadSlideAsync(unitId);
      return;
    case "base":
      await collaboration.loadBaseAsync(unitId);
      return;
    case "board":
      await collaboration.loadBoardAsync(unitId);
      return;
    case "sheet":
      await collaboration.loadSheetAsync(unitId);
      return;
  }
}

/** Materialize active Embed child descriptors after the host Unit is loaded. */
export async function materializeHostEmbedChildren(univer: Univer, hostUnitId: string): Promise<void> {
  const injector = univer.__getInjector();
  const embedModel = injector.get(EmbedModelService);
  const materializer = injector.get(EmbedReferencedUnitMaterializeService);
  const descriptors = [...embedModel.getActiveDescriptors(hostUnitId)];
  for (const descriptor of descriptors) {
    await materializer.materializeDescriptor({ descriptor });
  }
}

function toUniverInstanceType(unitType: ViewerOptions["unitType"]): UniverInstanceType {
  switch (unitType) {
    case "doc":
      return UniverInstanceType.UNIVER_DOC;
    case "slide":
      return UniverInstanceType.UNIVER_SLIDE;
    case "base":
      return UniverInstanceType.UNIVER_BASE;
    case "board":
      return UniverInstanceType.UNIVER_BOARD;
    case "sheet":
      return UniverInstanceType.UNIVER_SHEET;
  }
}
