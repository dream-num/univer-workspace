import { LocaleType } from "@univerjs/core";
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { WorkspaceHtmlViewFeature, type WorkspaceHtmlViewOptions } from "../src/html-view.js";

it("snapshots source-neutral bytes before awaiting trunk validation", async () => {
  const html = '<output data-univer-cell-text="unit:budget:B2"></output>';
  const bytes = Buffer.from(html);
  const upload = vi.fn<WorkspaceHtmlViewOptions["blobs"]["upload"]>(async (input) => {
    expect(await readFile(input.filePath, "utf8")).toBe(html);
    return { nodeId: "node", operationId: input.idempotencyKey };
  });
  const feature = new WorkspaceHtmlViewFeature({
    blobs: { upload },
    configuredOrigin: async () => "https://workspace.test",
    resolveTrunkRuntimeTarget: async () => {
      bytes.fill(0);
      return {
        origin: "https://workspace.test",
        scope: { kind: "trunk" },
        unitId: "unit",
        unitType: "sheet",
        revision: 1,
      };
    },
    runtime: {
      exportUnitData: async () => ({
        id: "unit",
        name: "Budget",
        appVersion: "1",
        locale: LocaleType.EN_US,
        styles: {},
        sheetOrder: ["budget"],
        sheets: { budget: { rowCount: 10, columnCount: 3 } },
      }),
    },
  });
  expect(
    await feature.create({
      source: { bytes, name: "view.univer.html" },
      name: "Dashboard",
      spaceId: "space",
      idempotencyKey: "key",
    }),
  ).toEqual({
    nodeId: "node",
    operationId: "key",
    workspaceUrl: "https://workspace.test/nodes/node",
  });
});
