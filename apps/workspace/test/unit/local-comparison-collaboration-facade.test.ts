import { CollaborationController } from "@univerjs-pro/collaboration-client";
import "@univerjs-pro/collaboration-client/facade";
import { Univer } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceLocalComparisonCollaborationFacadePlugin } from "../../web/src/features/editor/workarounds/local-comparison-collaboration-facade";

describe("local comparison collaboration facade workaround", () => {
  let univer: Univer | undefined;

  afterEach(() => {
    univer?.dispose();
    univer = undefined;
  });

  it("satisfies the collaboration facade without installing collaboration", () => {
    univer = new Univer();
    univer.registerPlugin(
      WorkspaceLocalComparisonCollaborationFacadePlugin
    );

    expect(univer.__getInjector().has(CollaborationController)).toBe(true);
    expect(() => FUniver.newAPI(univer!)).not.toThrow();
  });
});
