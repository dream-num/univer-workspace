import { afterEach, expect, it, vi } from "vitest";

vi.stubGlobal("Path2D", class {});
afterEach(() => vi.unstubAllGlobals());

it("registers data-validation mutations for HTML View source history replay", async () => {
  const {
    ICommandService, UniverInstanceType,
    IAuthzIoService, AuthzIoLocalService,
    IUndoRedoService, LocalUndoRedoService,
    IMentionIOService, MentionIOLocalService,
  } = await import("@univerjs/core");
  const { createWorkspaceHtmlUniver } = await import("../src/engine.js");
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
}, 30_000);
