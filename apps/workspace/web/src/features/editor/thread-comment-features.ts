import { UniverThreadCommentDataSourcePlugin } from "@univerjs-pro/thread-comment-datasource";
import {
  ICommandService,
  ILogService,
  type ICommandInfo,
} from "@univerjs/core";
import {
  DeleteDocCommentComment,
  type IDeleteDocCommentComment,
} from "@univerjs/docs-thread-comment-ui";
import type { IPresetPlugin } from "@univerjs/presets";
import {
  IThreadCommentDataSourceService,
  ThreadCommentModel,
} from "@univerjs/thread-comment";

const DEFAULT_DOC_SUBUNIT_ID = "default_doc";

type DocCommentDeleteDependencies = {
  dataSource: Pick<IThreadCommentDataSourceService, "deleteComment">;
  model: {
    getComment(
      unitId: string,
      subUnitId: string,
      commentId: string
    ):
      | {
          id: string;
          threadId: string;
          parentId?: string;
        }
      | undefined;
  };
};

/**
 * The SDK's document command removes the anchor itself. Remote comment bodies
 * live outside the collaboration snapshot, so Workspace removes the root body
 * after that command succeeds.
 */
export async function deleteDocRootCommentBody(
  commandInfo: Readonly<ICommandInfo>,
  { dataSource, model }: DocCommentDeleteDependencies
): Promise<boolean> {
  if (commandInfo.id !== DeleteDocCommentComment.id) {
    return false;
  }

  const params = commandInfo.params as
    | Partial<IDeleteDocCommentComment>
    | undefined;
  if (
    typeof params?.unitId !== "string" ||
    typeof params.commentId !== "string"
  ) {
    return false;
  }

  const comment = model.getComment(
    params.unitId,
    DEFAULT_DOC_SUBUNIT_ID,
    params.commentId
  );
  if (!comment || comment.parentId) {
    return false;
  }

  return dataSource.deleteComment(
    params.unitId,
    DEFAULT_DOC_SUBUNIT_ID,
    comment.threadId,
    comment.id
  );
}

export class UniverWorkspaceDocsThreadCommentDataSourcePlugin extends UniverThreadCommentDataSourcePlugin {
  static override pluginName =
    "UNIVER_WORKSPACE_DOC_THREAD_COMMENT_DATA_SOURCE_PLUGIN";
  static override packageName = "@univerjs/univer-workspace";
  static override version = UniverThreadCommentDataSourcePlugin.version;

  override onReady(): void {
    super.onReady();

    const commandService = this._injector.get(ICommandService);
    const dataSource = this._injector.get(IThreadCommentDataSourceService);
    const model = this._injector.get(ThreadCommentModel);
    const logService = this._injector.get(ILogService);

    this.disposeWithMe(
      commandService.onCommandExecuted((commandInfo) => {
        void deleteDocRootCommentBody(commandInfo, {
          dataSource,
          model,
        }).catch((error: unknown) => {
          logService.error(
            "[Workspace] Failed to delete the document comment body",
            error
          );
        });
      })
    );
  }
}

/** Browser-side remote body integration; anchors remain Collaboration resources. */
export function getThreadCommentCollaborationPlugins(
  enabled = true
): IPresetPlugin[] {
  return enabled ? [UniverThreadCommentDataSourcePlugin] : [];
}

/** Trunk-only document integration, including remote root-comment cleanup. */
export function getDocThreadCommentCollaborationPlugins(
  enabled = true
): IPresetPlugin[] {
  return enabled
    ? [UniverWorkspaceDocsThreadCommentDataSourcePlugin]
    : [];
}
