import { CollaborationController } from "@univerjs-pro/collaboration-client";
import {
  Injector,
  Plugin,
  UniverInstanceType,
  setDependencies,
} from "@univerjs/core";
import { EMPTY } from "rxjs";

/**
 * SDK workaround for materialized, non-collaborative comparison viewers.
 *
 * Importing collaboration-client/facade extends FUniver globally. Its
 * initializer currently requires CollaborationController even when the host
 * never calls the collaboration facade. Comparison viewers deliberately omit
 * the collaboration client, so register only the inert event source consumed
 * by that initializer. Remove this plugin when the upstream facade dependency
 * becomes optional.
 */
export class WorkspaceLocalComparisonCollaborationFacadePlugin extends Plugin {
  static override type = UniverInstanceType.UNIVER_UNKNOWN;
  static override pluginName =
    "UNIVER_WORKSPACE_LOCAL_COMPARISON_COLLABORATION_FACADE_PLUGIN";
  static override packageName = "@univerjs/univer-workspace";

  constructor(protected override _injector: Injector) {
    super();
  }

  override onStarting(): void {
    if (this._injector.has(CollaborationController)) return;
    this._injector.add([
      CollaborationController,
      {
        useValue: {
          entityInit$: EMPTY,
        } as unknown as CollaborationController,
      },
    ]);
  }
}

setDependencies(WorkspaceLocalComparisonCollaborationFacadePlugin, [Injector]);
