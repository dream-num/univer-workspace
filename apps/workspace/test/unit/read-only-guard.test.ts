import { CommandType } from "@univerjs/core";
import { describe, expect, it } from "vitest";
import {
  isReadOnlyBlockedMutation,
  isReferencedSourceBlockedMutation,
} from "../../web/src/features/editor/features/read-only-guard.js";

const guarded = new Set(["unit-1", "mapped-1"]);
const mutation = (id: string, params?: unknown, options?: Record<string, boolean>) => ({
  id,
  type: CommandType.MUTATION,
  params,
  ...(options ? { options } : {}),
});

describe("referenced source guard", () => {
  const sourceTypes = ["base", "doc", "slide", "board"];
  const referenced = new Set(sourceTypes.map((type) => `${type}-source`));

  it.each(sourceTypes)("blocks local edits of a referenced %s without blocking its host", (type) => {
    const id = `${type}.mutation.edit-content`;
    expect(isReferencedSourceBlockedMutation(mutation(id, { unitId: `${type}-source` }), referenced)).toBe(true);
    expect(isReferencedSourceBlockedMutation(mutation(id, { unitId: "editable-host" }), referenced)).toBe(false);
    expect(isReferencedSourceBlockedMutation(mutation(id), referenced)).toBe(false);
  });

  it.each(sourceTypes)("allows collaboration and replay to update a referenced %s", (type) => {
    for (const options of [{ fromCollab: true }, { fromChangeset: true }, { onlyLocal: true }]) {
      expect(isReferencedSourceBlockedMutation(
        mutation(`${type}.mutation.edit-content`, { unitId: `${type}-source` }, options), referenced,
      )).toBe(false);
    }
  });

  it("leaves source commands and operations enabled", () => {
    for (const type of [CommandType.COMMAND, CommandType.OPERATION]) {
      expect(isReferencedSourceBlockedMutation({
        id: "base.command.select-view", type, params: { unitId: "base-source" },
      }, referenced)).toBe(false);
    }
  });
});

describe("read-only editor guard", () => {
  it("blocks local content mutations aimed at the guarded Units", () => {
    expect(
      isReadOnlyBlockedMutation(
        mutation("doc.mutation.rich-text-editing", { unitId: "unit-1" }),
        guarded,
      ),
    ).toBe(true);
    expect(
      isReadOnlyBlockedMutation(
        mutation("sheet.mutation.set-range-values", { unitId: "mapped-1" }),
        guarded,
      ),
    ).toBe(true);
    // Without a unitId the mutation is assumed to target the opened Unit.
    expect(isReadOnlyBlockedMutation(mutation("sheet.mutation.anything"), guarded)).toBe(true);
  });

  it("keeps collaboration, changeset replay and local-only mutations", () => {
    for (const options of [{ fromCollab: true }, { fromChangeset: true }, { onlyLocal: true }]) {
      expect(
        isReadOnlyBlockedMutation(
          mutation("doc.mutation.rich-text-editing", { unitId: "unit-1" }, options),
          guarded,
        ),
      ).toBe(false);
    }
  });

  it("keeps mutations for other Units such as the comment input document", () => {
    expect(
      isReadOnlyBlockedMutation(
        mutation("doc.mutation.rich-text-editing", { unitId: "__comment_editor__" }),
        guarded,
      ),
    ).toBe(false);
  });

  it("keeps comment mutations on the guarded Unit", () => {
    for (const id of [
      "thread-comment.mutation.add-comment",
      "thread-comment.mutation.update-comment",
      "thread-comment.mutation.resolve-comment",
      "thread-comment.mutation.delete-comment",
      "docs-thread-comment.mutation.add-decoration",
    ]) {
      expect(isReadOnlyBlockedMutation(mutation(id, { unitId: "unit-1" }), guarded), id).toBe(
        false,
      );
    }
  });

  it("never cancels commands or operations", () => {
    expect(
      isReadOnlyBlockedMutation(
        { id: "doc.command.anything", type: CommandType.COMMAND, params: { unitId: "unit-1" } },
        guarded,
      ),
    ).toBe(false);
    expect(
      isReadOnlyBlockedMutation(
        { id: "doc.operation.anything", type: CommandType.OPERATION, params: { unitId: "unit-1" } },
        guarded,
      ),
    ).toBe(false);
  });
});
