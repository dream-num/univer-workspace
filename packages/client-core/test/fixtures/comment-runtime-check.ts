import assert from "node:assert/strict";
import {
  createStandardHeadlessUniverFactory,
  createStandardHeadlessUniverFacade,
} from "@univer-cli/headless-univer";
import {
  ICommandService,
  IResourceManagerService,
  UniverInstanceType,
  type UnitModel,
} from "@univerjs/core";
import { installCommentReplayCompatibility } from "../../src/workarounds/comment-replay.js";

const type = Number(process.argv[2]) as UniverInstanceType;
const repaired = process.argv[3] !== "bare";
const id = `comment-${type}`;
const univer = await createStandardHeadlessUniverFactory({ license: "" })({
  unitId: id,
  unitType: type,
});
try {
  if (repaired) installCommentReplayCompatibility(univer, type);
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
    repaired || type === UniverInstanceType.UNIVER_SHEET ? 1 : 0,
  );
  if (repaired) {
    // Verify serialized resources survive a fresh runtime, not just an in-memory model.
    const restored = await createStandardHeadlessUniverFactory({ license: "" })({
      unitId: id,
      unitType: type,
    });
    try {
      installCommentReplayCompatibility(restored, type);
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
