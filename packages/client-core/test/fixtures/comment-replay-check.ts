import assert from "node:assert/strict";
import {
  createStandardHeadlessUniverFacade,
  createStandardHeadlessUniverFactory,
} from "@univer-cli/headless-univer";
import {
  ICommandService,
  IResourceManagerService,
  UniverInstanceType,
  type UnitModel,
} from "@univerjs/core";
import { installCommentReplayCompatibility as install } from "../../src/workarounds/comment-replay.js";

// Runs in a plain Node ESM process: Vitest-inlined and external SDK modules
// would otherwise split DI decorator metadata across module instances.
for (const type of [
  UniverInstanceType.UNIVER_SHEET,
  UniverInstanceType.UNIVER_DOC,
  UniverInstanceType.UNIVER_SLIDE,
  UniverInstanceType.UNIVER_BASE,
  UniverInstanceType.UNIVER_BOARD,
]) {
  const id = `comment-${type}`;
  const univer = await createStandardHeadlessUniverFactory({ license: "" })({
    unitId: id,
    unitType: type,
  });
  try {
    install(univer);
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
    const subUnitId = type === UniverInstanceType.UNIVER_DOC ? "default_doc" : "subunit-1";
    assert.ok(
      await api.executeCommand(
        "thread-comment.mutation.add-comment",
        {
          unitId: id,
          subUnitId,
          comment: {
            id: "anchor-1",
            threadId: "thread-1",
            unitId: id,
            subUnitId,
            ref: "A1",
            text: { dataStream: "Existing comment\r\n" },
            personId: "author",
            dT: "2026-10-14",
          },
        },
        { fromCollab: true },
      ),
      `add-comment mutation missing for type ${type}`,
    );
    unit.setName("Draft edited");
    const data = unit.save();
    const resources = univer.__getInjector().get(IResourceManagerService).getResources(id, type);
    const anchors = resources.filter((resource) => resource.data.includes("anchor-1"));
    assert.equal(anchors.length, 1, `anchor resource missing for type ${type}`);

    // The serialized resource must survive a fresh runtime, not only the model.
    const restored = await createStandardHeadlessUniverFactory({ license: "" })({
      unitId: id,
      unitType: type,
    });
    try {
      install(restored);
      restored.createUnit<{ id: string; resources: typeof resources }, UnitModel>(type, {
        ...data,
        resources,
      });
      const saved = restored.__getInjector().get(IResourceManagerService).getResources(id, type);
      assert.equal(
        saved.filter((resource) => resource.data.includes("anchor-1")).length,
        1,
        `anchor resource lost after restore for type ${type}`,
      );
      assert.ok(
        restored
          .__getInjector()
          .get(ICommandService)
          .hasCommand("thread-comment.mutation.add-comment"),
      );
    } finally {
      restored.dispose();
    }
  } finally {
    univer.dispose();
  }
}
