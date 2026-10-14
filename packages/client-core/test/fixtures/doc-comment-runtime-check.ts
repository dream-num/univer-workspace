import assert from "node:assert/strict";
import {
  createStandardHeadlessUniverFactory,
  createStandardHeadlessUniverFacade,
} from "@univer-cli/headless-univer";
import {
  BuildTextUtils,
  CustomDecorationType,
  JSONX,
  TextXActionType,
  UniverInstanceType,
  getDocsEmptySnapshot,
} from "@univerjs/core";
import { installDocCommentReplayCompatibility } from "../../src/workarounds/doc-comment-replay.js";

const univer = await createStandardHeadlessUniverFactory({ license: "" })({
  unitId: "doc-comments",
  unitType: UniverInstanceType.UNIVER_DOC,
});
try {
  installDocCommentReplayCompatibility(univer, UniverInstanceType.UNIVER_DOC);
  const data = getDocsEmptySnapshot("doc-comments");
  data.body = {
    dataStream: "Hello world\r\n",
    paragraphs: [{ startIndex: 11, paragraphId: "para_p1" }],
    sectionBreaks: [{ startIndex: 12, sectionId: "section_p1" }],
  };
  data.resources = [
    {
      name: "DOC_UNIVER_THREAD_COMMENT_PLUGIN",
      data: JSON.stringify({
        default_doc: [{ id: "comment-1", threadId: "thread-1", ref: "Hello" }],
      }),
    },
  ];
  univer.createUnit(UniverInstanceType.UNIVER_DOC, data);
  const api = createStandardHeadlessUniverFacade(univer);
  const decoration = BuildTextUtils.customDecoration.add({
    ranges: [{ startOffset: 0, endOffset: 5, collapsed: false }],
    id: "comment-1",
    type: CustomDecorationType.COMMENT,
  });
  assert.ok(
    await api.executeCommand("docs-thread-comment.mutation.add-decoration", {
      unitId: "doc-comments",
      actions: JSONX.getInstance().editOp(decoration.serialize()),
    }),
  );
  assert.ok(
    await api.executeCommand("doc.mutation.rich-text-editing", {
      unitId: "doc-comments",
      actions: JSONX.getInstance().editOp([
        { t: TextXActionType.INSERT, len: 6, body: { dataStream: "Draft " } },
      ]),
    }),
  );
  const saved = api.getDocument("doc-comments")!.save();
  assert.equal(saved.body!.dataStream, "Draft Hello world\r\n");
  assert.equal(saved.body!.customDecorations![0]!.startIndex, 6);
  const resource = api
    .getDocument("doc-comments")!
    .save()
    .resources?.find((resource) => resource.name === "DOC_UNIVER_THREAD_COMMENT_PLUGIN");
  assert.ok(resource);
  assert.equal(JSON.parse(resource.data).default_doc[0].threadId, "thread-1");
} finally {
  univer.dispose();
}
