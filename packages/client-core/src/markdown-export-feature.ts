import { readDocMarkdown } from "@univer-cli/doc-markdown-facade";
import type { WorkspaceContentRuntimeOperations } from "./content-runtime.js";
import type { WorkspaceRuntimeTarget } from "./runtime-target.js";
import { workspaceError } from "./errors.js";
import {
  type WorkspaceMarkdownExportResult,
  type WorkspaceMarkdownReadOptions,
} from "./markdown-export.js";
import {
  readWorkspaceMarkdownImage,
  type WorkspaceMarkdownAssetRequest,
} from "./markdown-assets.js";

export interface WorkspaceExportMarkdownInput extends Omit<
  WorkspaceMarkdownReadOptions,
  "targetUnitId"
> {
  readonly unitId: string;
  readonly worktreeId: string;
}

/** Read the live native Doc under one synchronized lease; no source Markdown is consulted. */
export class WorkspaceExportMarkdownFeature {
  public constructor(
    private readonly dependencies: {
      readonly resolveRuntimeTarget: (input: {
        readonly unitId: string;
        readonly worktreeId: string;
      }) => Promise<WorkspaceRuntimeTarget>;
      readonly runtime: Pick<WorkspaceContentRuntimeOperations, "executeRead">;
      readonly assetRequest: WorkspaceMarkdownAssetRequest;
    },
  ) {}

  public async execute(
    input: WorkspaceExportMarkdownInput,
  ): Promise<WorkspaceMarkdownExportResult> {
    const target = await this.dependencies.resolveRuntimeTarget({
      unitId: input.unitId,
      worktreeId: input.worktreeId,
    });
    if (target.unitType !== "doc")
      throw workspaceError("workspace-unit-type-mismatch", "Markdown export requires a Doc Unit.");
    return await readDocMarkdown(
      {
        targetUnitId: input.unitId,
        sourceMap: input.sourceMap,
        blockIds: input.blockIds,
      },
      {
        read: async (code) => {
          const read = await this.dependencies.runtime.executeRead({ target, code });
          return { value: read.value, revision: read.state.baseRevision };
        },
        assetResolver: async (reference) =>
          await readWorkspaceMarkdownImage(reference, {
            origin: target.origin,
            worktreeId: input.worktreeId,
            request: this.dependencies.assetRequest,
          }),
      },
    );
  }
}
