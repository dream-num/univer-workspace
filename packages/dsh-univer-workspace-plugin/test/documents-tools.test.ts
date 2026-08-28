import { describe, expect, it } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { registerDocumentTools } from "../src/tools/documents.ts";

function toolContext() {
  const definitions: ToolDefinition[] = [];
  const disposed: string[] = [];
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        definitions.push(definition);
        return () => disposed.push(definition.name);
      },
    },
  } as unknown as Context;
  return { ctx, definitions, disposed };
}

describe("document tool registration contract", () => {
  it("registers the stable discovery, status, and creation tool set", () => {
    const { ctx, definitions, disposed } = toolContext();
    const dispose = registerDocumentTools(ctx);

    expect(definitions.map(definition => definition.name)).toEqual([
      "univer_documents",
      "univer_list",
      "univer_open",
      "univer_status",
      "univer_new",
      "univer_create",
    ]);

    const byName = new Map(definitions.map(definition => [definition.name, definition]));
    expect(byName.get("univer_documents")?.parameters).toEqual(byName.get("univer_list")?.parameters);
    expect(byName.get("univer_documents")?.parameters).toMatchObject({
      type: "object",
      properties: {
        spaceId: { type: "string", description: expect.stringContaining("accessible to the authenticated User") },
        parentNodeId: { type: "string" },
        recursive: { type: "boolean" },
        query: { type: "string" },
        resourceKind: { type: "string", enum: ["univer", "blob", "folder", "all"] },
        unitType: { type: "string", enum: ["sheet", "doc", "slide", "board", "base"] },
      },
    });
    expect(byName.get("univer_open")?.parameters).toEqual({
      type: "object",
      properties: { resourceId: { type: "string" } },
      required: ["resourceId"],
    });
    expect(byName.get("univer_status")?.parameters).toMatchObject({
      type: "object",
      properties: {
        resourceId: { type: "string" },
        worktreeId: { type: "string" },
        unitId: { type: "string", description: "Optional Unit filter inside the selected Worktree." },
      },
    });
    for (const name of ["univer_new", "univer_create"]) {
      expect(byName.get(name)?.parameters).toMatchObject({
        type: "object",
        required: ["spaceId", "name", "unitType"],
        properties: {
          spaceId: { type: "string" },
          name: { type: "string" },
          unitType: { type: "string", enum: ["sheet", "doc", "slide", "board", "base"] },
          parentNodeId: { type: "string" },
        },
      });
    }

    dispose();
    expect(disposed).toEqual([
      "univer_documents",
      "univer_list",
      "univer_open",
      "univer_status",
      "univer_new",
      "univer_create",
    ]);
  });

  it("keeps the open and list renderers model-readable", () => {
    const { ctx, definitions } = toolContext();
    registerDocumentTools(ctx);
    const open = definitions.find(definition => definition.name === "univer_open");
    const list = definitions.find(definition => definition.name === "univer_documents");
    if (open === undefined || list === undefined) throw new Error("document tools were not registered");

    expect(open.output.render({}, { resourceId: "res-1", unitId: "unit-1" })).toEqual([
      { type: "text", text: JSON.stringify({ resourceId: "res-1", unitId: "unit-1" }) },
    ]);
    expect(list.output.render({}, { spaceId: "sp-1", documents: [], folders: [] })).toEqual([
      { type: "text", text: "no documents" },
    ]);
  });
});
