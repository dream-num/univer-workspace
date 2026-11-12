import { expect, it, vi } from "vitest";

vi.hoisted(() => {
  globalThis.Path2D ??= class {} as typeof Path2D;
});

import {
  ICommandService, UniverInstanceType,
  IAuthzIoService, AuthzIoLocalService,
  IUndoRedoService, LocalUndoRedoService,
  IMentionIOService, MentionIOLocalService,
} from "@univerjs/core";
import { createWorkspaceHtmlUniver } from "../src/engine.js";

it("registers data-validation mutations for HTML View source history replay", () => {
  const univer = createWorkspaceHtmlUniver("");
  try {
    // Use local services instead of starting collaboration transport in this model test.
    const injector = univer.__getInjector();
    injector.add([IAuthzIoService, { useClass: AuthzIoLocalService }]);
    injector.add([IUndoRedoService, { useClass: LocalUndoRedoService }]);
    injector.add([IMentionIOService, { useClass: MentionIOLocalService }]);
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, { id: "source-sheet" });
    expect(
      univer.__getInjector().get(ICommandService).hasCommand("data-validation.mutation.addRule"),
    ).toBe(true);
  } finally {
    univer.dispose();
  }
});
