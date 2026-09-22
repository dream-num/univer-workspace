import { CellValueType, type IWorkbookData } from "@univerjs/core";
import type { ISnapshotServerService } from "@univerjs-pro/collaboration";
import { transformWorkbookDataToSnapshot } from "@univerjs-pro/collaboration";
import { ErrorCode, UniverType, type ISheetBlock } from "@univerjs/protocol";

/** Fresh Sheet data plus changesets, without importing a pre-existing snapshot. */
export async function createReferencedSheetSource(data: IWorkbookData) {
  const blocks = new Map<string, ISheetBlock>();
  const ok = { code: ErrorCode.OK, message: "" };
  const unsupported = async (): Promise<never> => {
    throw new Error("Unexpected snapshot write or request");
  };
  const server: ISnapshotServerService = {
    getUnitOnRev: unsupported,
    getDeserializedSheetBlock: unsupported,
    fetchMissingChangesets: unsupported,
    updateSnapshot: unsupported,
    saveChangeset: unsupported,
    copyFileMeta: unsupported,
    getLatestCsReqIdBySid: unsupported,
    saveSheetBlock: async (_context, request) => {
      const blockID = `block-${blocks.size}`;
      blocks.set(blockID, { ...request.block!, id: blockID });
      return { blockID, error: ok };
    },
    saveSnapshot: async () => ({ error: ok }),
    getSheetBlock: async (_context, request) => ({ block: blocks.get(request.blockID), error: ok }),
    getResourcesRequest: async () => ({ resources: {}, error: ok }),
  };
  server.getDeserializedSheetBlock = server.getSheetBlock;
  const { snapshot } = await transformWorkbookDataToSnapshot({}, data, data.id, 1, server);
  server.getUnitOnRev = async () => ({
    snapshot,
    error: ok,
    changesets: [
      {
        unitID: data.id,
        type: UniverType.UNIVER_SHEET,
        baseRev: 1,
        revision: 2,
        userID: "user",
        memberID: "member",
        mutations: [
          {
            id: "sheet.mutation.set-worksheet-name",
            data: JSON.stringify({ unitId: data.id, subUnitId: "tab", name: "Finance" }),
          },
          {
            id: "sheet.mutation.set-range-values",
            data: JSON.stringify({
              unitId: data.id,
              subUnitId: "tab",
              cellValue: { 0: { 0: { v: 12500, t: CellValueType.NUMBER } } },
            }),
          },
        ],
      },
    ],
  });
  return server;
}
