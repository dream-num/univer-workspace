import assert from "node:assert/strict";
import {
  createStandardHeadlessUniverFactory,
  createStandardHeadlessUniverFacade,
} from "@univer-cli/headless-univer";
import {
  ICommandService,
  IResourceManagerService,
  Univer,
  UniverInstanceType,
  type UnitModel,
} from "@univerjs/core";
import {
  installHeadlessCommentCompatibility,
  registerCommentModels,
} from "../../src/runtime/comment-models.js";

const type = Number(process.argv[2]) as UniverInstanceType;
const repaired = !process.argv[3]?.endsWith("bare");
const browser = process.argv[3]?.startsWith("viewer") ?? false;
const id = `comment-${type}`;
const create = async () => {
  if (!browser)
    return await createStandardHeadlessUniverFactory({ license: "" })({
      unitId: id,
      unitType: type,
    });
  const runtime = new Univer();
  const [
    { UniverSheetsPlugin },
    { UniverDocsPlugin },
    { UniverSlidesPlugin },
    { UniverBasesPlugin },
    { UniverBoardsPlugin },
  ] = await Promise.all([
    import("@univerjs/sheets"),
    import("@univerjs/docs"),
    import("@univerjs-pro/slides"),
    import("@univerjs-pro/bases"),
    import("@univerjs-pro/boards"),
  ]);
  for (const plugin of [
    UniverSheetsPlugin,
    UniverDocsPlugin,
    UniverSlidesPlugin,
    UniverBasesPlugin,
    UniverBoardsPlugin,
  ])
    runtime.registerPlugin(plugin);
  return runtime;
};
const univer = await create();
try {
  const install = async (runtime: typeof univer) => {
    if (!browser) {
      installHeadlessCommentCompatibility(runtime, type);
      return;
    }
    Object.defineProperty(globalThis, "Path2D", { configurable: true, value: class Path2D {} });
    const { registerViewerRendering, ViewAssetIoOwner } =
      await import("../../src/client/viewer/rendering.ts");
    const plugins: Array<Parameters<typeof runtime.registerPlugin>[0]> = [];
    registerViewerRendering(
      {
        registerPlugin: (plugin: Parameters<typeof runtime.registerPlugin>[0]) =>
          plugins.push(plugin),
        __getInjector: () => runtime.__getInjector(),
        onDispose: () => undefined,
      } as unknown as typeof runtime,
      {
        container: "test",
        assetIoOwner: ViewAssetIoOwner.Local,
        license: "",
        workbenchChrome: "hidden",
        readOnly: true,
        unitType: type,
      },
    );
    const models: Array<Parameters<typeof runtime.registerPlugin>[0]> = [];
    registerCommentModels({
      registerPlugin: (plugin: Parameters<typeof runtime.registerPlugin>[0]) => models.push(plugin),
    } as unknown as typeof runtime);
    for (const model of models) {
      assert.ok(plugins.includes(model), model.pluginName);
      runtime.registerPlugin(model);
    }
  };
  if (repaired) await install(univer);
  const api = createStandardHeadlessUniverFacade(univer);
  const input = { id, name: "Before" };
  const unit =
    type === UniverInstanceType.UNIVER_SHEET
      ? api.createWorkbook(input)
      : type === UniverInstanceType.UNIVER_DOC
        ? api.createDocument(input)
        : type === UniverInstanceType.UNIVER_SLIDE
          ? api.createPresentation(input)
          : type === UniverInstanceType.UNIVER_BASE
            ? api.createBase(input)
            : api.createBoard(input);
  let data = unit.save();
  const subUnitId = type === UniverInstanceType.UNIVER_DOC ? "default_doc" : "subunit-1";
  const comment = {
    id: "anchor-1",
    threadId: "thread-1",
    unitId: id,
    subUnitId,
    ref: "A1",
    text: { dataStream: "Existing comment\r\n" },
    personId: "author",
    dT: "2026-10-14",
  };
  if (!repaired && browser) {
    await assert.rejects(
      api.executeCommand(
        "thread-comment.mutation.add-comment",
        { unitId: id, subUnitId, comment },
        { fromCollab: true },
      ),
      /is not registered/,
    );
  } else
    assert.ok(
      await api.executeCommand(
        "thread-comment.mutation.add-comment",
        { unitId: id, subUnitId, comment },
        { fromCollab: true },
      ),
    );
  if (repaired) {
    unit.setName("Draft edited");
    data = unit.save();
    assert.ok(JSON.stringify(data).includes("Draft edited"));
  }
  const resources = univer.__getInjector().get(IResourceManagerService).getResources(id, type);
  const commentResources = resources.filter((resource) => resource.data.includes("anchor-1"));
  assert.equal(
    commentResources.length,
    repaired || (!browser && type === UniverInstanceType.UNIVER_SHEET) ? 1 : 0,
  );
  if (process.env.UNIVER_COMMENT_SNAPSHOT_OUT) {
    const { writeFile } = await import("node:fs/promises");
    const transform = await import("@univerjs-pro/collaboration");
    const blocks: import("@univerjs/protocol").ISheetBlock[] = [];
    const service = {
      saveSnapshot: async () => ({ error: { code: 0, message: "" } }),
      saveSheetBlock: async (
        _context: unknown,
        request: { block: import("@univerjs/protocol").ISheetBlock },
      ) => {
        blocks.push(request.block);
        return { blockID: request.block.id, error: { code: 0, message: "" } };
      },
    } as unknown as import("@univerjs-pro/collaboration").ISnapshotServerService;
    const saved = { ...data, resources };
    const converted =
      type === UniverInstanceType.UNIVER_SHEET
        ? await transform.transformWorkbookDataToSnapshot(
            {},
            saved as import("@univerjs/core").IWorkbookData,
            id,
            1,
            service,
          )
        : type === UniverInstanceType.UNIVER_DOC
          ? await transform.transformDocumentDataToSnapshot(
              {},
              saved as import("@univerjs/core").IDocumentData,
              id,
              1,
              service,
            )
          : type === UniverInstanceType.UNIVER_SLIDE
            ? await transform.transformSlideDataToSnapshot(
                resources,
                saved as import("@univerjs-pro/slides").ISlideData,
                id,
                1,
                service,
              )
            : type === UniverInstanceType.UNIVER_BASE
              ? await transform.transformBaseDataToSnapshot(
                  {},
                  saved as import("@univerjs/core").IBaseSnapshot,
                  id,
                  1,
                  service,
                )
              : await transform.transformBoardDataToSnapshot(
                  resources,
                  saved as import("@univerjs-pro/boards").IBoardData,
                  id,
                  1,
                  service,
                );
    const replay = {
      unitID: id,
      type,
      baseRev: 1,
      revision: 2,
      sid: "probe",
      reqId: 1,
      userID: "author",
      memberID: "probe",
      createTime: 1,
      mutations: [
        {
          id: "thread-comment.mutation.add-comment",
          data: JSON.stringify({
            unitId: id,
            subUnitId,
            comment: { ...comment, id: "replayed-anchor", threadId: "replayed-thread" },
          }),
        },
      ],
    };
    await writeFile(
      process.env.UNIVER_COMMENT_SNAPSHOT_OUT,
      JSON.stringify(
        { id, type, snapshot: converted.snapshot, changesets: [replay], blocks },
        (_key, value: unknown) =>
          value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value,
      ),
    );
  }
  if (repaired) {
    // Verify serialized resources survive a fresh runtime, not just an in-memory model.
    const restored = await create();
    try {
      await install(restored);
      restored.createUnit<{ id: string; resources: typeof resources }, UnitModel>(type, {
        ...data,
        resources,
      });
      const saved = restored.__getInjector().get(IResourceManagerService).getResources(id, type);
      assert.equal(saved.filter((resource) => resource.data.includes("anchor-1")).length, 1);
      assert.ok(
        restored
          .__getInjector()
          .get(ICommandService)
          .hasCommand("thread-comment.mutation.add-comment"),
      );
    } finally {
      restored.dispose();
    }
  }
} finally {
  univer.dispose();
}
