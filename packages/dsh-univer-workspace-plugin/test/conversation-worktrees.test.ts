import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { describe, expect, it, vi } from "vitest";
import { registerDocumentStatusTools } from "../src/tools/documents-status.ts";
import { registerEditTool } from "../src/tools/edit.ts";
import { registerWorktreeTools } from "../src/tools/worktree.ts";
import { conversation } from "./conversation-exec.ts";

function workspace() {
  const worktrees: string[] = [];
  const entry = (worktreeId: string) => ({
    worktreeId,
    name: "Budget",
    status: "draft",
    units: [{ unitId: "sheet-1", resourceId: "res-1", name: "Budget", unitType: "sheet", source: "trunk" }],
  });
  const service = {
    resolveSpaceForSession: vi.fn(async () => ({ userId: "user-1", spaceId: "space-1" })),
    createWorktree: vi.fn(async () => {
      worktrees.push(`wt-${worktrees.length + 1}`);
      return { id: worktrees.at(-1), name: "Budget", state: "draft", unitCount: 0 };
    }),
    openDocument: vi.fn(async () => ({ resourceId: "res-1", unitId: "sheet-1", unitType: "sheet", nodeId: "node-1", name: "Budget" })),
    resolveUnitResource: vi.fn(async () => ({ resourceId: "res-1", unitId: "sheet-1", unitType: "sheet" })),
    getFileState: vi.fn(async () => ({ resourceId: "res-1", worktrees: worktrees.map(entry) })),
    getWorktreeFileState: vi.fn(async (_userId: string, worktreeId: string) => ({ resourceId: "res-1", worktrees: [entry(worktreeId)] })),
    editUnit: vi.fn(async () => ({ committed: true })),
    inspectUnit: vi.fn(async () => ({ sheets: ["Sheet1"] })),
    markWorktreeReady: vi.fn(),
    reopenWorktree: vi.fn(),
  };
  const tools = new Map<string, ToolDefinition>();
  const ctx = {
    get: () => service,
    on: () => () => undefined,
    tools: { register: (definition: ToolDefinition) => {
      tools.set(definition.name, definition);
      return () => undefined;
    } },
  } as unknown as Context;
  registerWorktreeTools(ctx);
  registerEditTool(ctx);
  registerDocumentStatusTools(ctx);
  return { service, tool: (name: string) => tools.get(name)! };
}

const listed = (status: unknown) =>
  (status as { fileState: { worktrees: { worktreeId: string; createdInThisConversation: boolean }[] } }).fileState.worktrees
    .map(({ worktreeId, createdInThisConversation }) => ({ worktreeId, createdInThisConversation }));

describe("one Worktree per conversation", () => {
  it("lets a second conversation read the first conversation's Worktree but never write, ready, or reopen it", async () => {
    const { service, tool } = workspace();
    const first = conversation("/tmp/session");
    const second = conversation("/tmp/session");
    const { id } = (await first.call(tool("univer_worktree"), { action: "create", name: "Budget" })) as { id: string };
    const edit = { worktreeId: id, unitId: "sheet-1", unitType: "sheet", code: "workbook.getActiveSheet().getRange('A1').setValue(1)" };
    await first.call(tool("univer_execute"), edit);
    expect(service.editUnit).toHaveBeenCalledTimes(1);

    expect(listed(await second.call(tool("univer_status"), { resourceId: "res-1" })))
      .toEqual([{ worktreeId: id, createdInThisConversation: false }]);
    for (const [name, args] of [
      ["univer_execute", edit],
      ["univer_edit", { ...edit, mode: "write" }],
      ["univer_worktree", { action: "ready", worktreeId: id }],
      ["univer_worktree", { action: "reopen", worktreeId: id }],
    ] as const) {
      await expect(second.call(tool(name), args)).rejects.toMatchObject({ code: "WORKTREE_NOT_IN_CONVERSATION" });
    }
    expect(service.editUnit).toHaveBeenCalledTimes(1);
    expect(service.markWorktreeReady).not.toHaveBeenCalled();
    expect(service.reopenWorktree).not.toHaveBeenCalled();
    await expect(second.call(tool("univer_inspect"), { worktreeId: id, unitId: "sheet-1", unitType: "sheet" }))
      .resolves.toMatchObject({ ok: true });

    const own = (await second.call(tool("univer_worktree"), { action: "create", name: "Budget" })) as { id: string };
    await second.call(tool("univer_execute"), { ...edit, worktreeId: own.id });
    expect(service.editUnit).toHaveBeenCalledTimes(2);
    expect(listed(await first.call(tool("univer_status"), { resourceId: "res-1" }))).toEqual([
      { worktreeId: id, createdInThisConversation: true },
      { worktreeId: own.id, createdInThisConversation: false },
    ]);
  });

  it("counts a Worktree created inside run_code and ignores a failed create", async () => {
    const { service, tool } = workspace();
    const chat = conversation("/tmp/session");
    const dispatch = (subCallId: string, id: string, isError: boolean) => chat.events.push({
      type: "tool/ptc-dispatch",
      data: { rootCallId: "run", parentCallId: "run", subCallId, name: "univer_worktree", arguments: { action: "create" }, isError,
        content: [{ type: "text", text: JSON.stringify({ id }) }] },
    });
    dispatch("run:ptc:0", "wt-ptc", false);
    dispatch("run:ptc:1", "wt-failed", true);
    const edit = { unitId: "sheet-1", unitType: "sheet", code: "return 1" };
    await chat.call(tool("univer_execute"), { ...edit, worktreeId: "wt-ptc" });
    await expect(chat.call(tool("univer_execute"), { ...edit, worktreeId: "wt-failed" }))
      .rejects.toMatchObject({ code: "WORKTREE_NOT_IN_CONVERSATION" });
    expect(service.editUnit).toHaveBeenCalledTimes(1);
  });
});
