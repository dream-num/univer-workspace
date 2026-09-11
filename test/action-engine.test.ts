import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { ActionService } from "../src/kernel/action.ts";
import { DatabaseSync } from "node:sqlite";
import type { SqlExec } from "../src/kernel/sql.ts";

function createSqliteAdapter(): SqlExec {
  const db = new DatabaseSync(":memory:");
  return {
    exec: (query: string, ...binds: unknown[]) => {
      const trimmed = query.trim().toUpperCase();
      if (trimmed.startsWith("CREATE") || trimmed.startsWith("DROP")) {
        db.exec(query);
        return { toArray: () => [] };
      }
      const stmt = db.prepare(query);
      if (trimmed.startsWith("INSERT") || trimmed.startsWith("UPDATE") || trimmed.startsWith("DELETE")) {
        stmt.run(...(binds as any[]));
        return { toArray: () => [] };
      }
      const rows = stmt.all(...(binds as any[]));
      return {
        toArray: () => rows as Record<string, unknown>[]
      };
    }
  };
}

describe("Cordis Universal Action Engine", () => {
  test("registers, executes, and reverses actions with journal logging", async () => {
    const ctx = new Context();
    const sql = createSqliteAdapter();
    const actionService = new ActionService(ctx, sql);

    let cellValue = "initial";

    // Register a cell update action with reversible inverse
    actionService.register({
      id: "sheet.updateCell",
      name: "Update Cell",
      description: "Updates a single sheet cell value with reversible undo",
      schema: {
        type: "object",
        properties: {
          cell: { type: "string" },
          value: { type: "string" }
        }
      },
      exposeAsTool: true,
      exposeAsRpc: true,
      execute: async (input) => {
        const oldValue = cellValue;
        cellValue = input.value;
        return { previousValue: oldValue, newValue: input.value };
      },
      reverse: async (input, result) => {
        cellValue = result.previousValue;
      }
    });

    // Verify listed tools for LLM
    const tools = actionService.getLlmTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "sheet_updateCell");

    // Execute action
    const execRes = await actionService.execute("sheet.updateCell", {
      cell: "A1",
      value: "hello world"
    });
    assert.equal(cellValue, "hello world");
    assert.equal(execRes.previousValue, "initial");

    // Reverse action
    const reversed = await actionService.reverseLast();
    assert.equal(reversed, true);
    assert.equal(cellValue, "initial", "Cell value should be restored to initial state via inverse execution");
  });
});
