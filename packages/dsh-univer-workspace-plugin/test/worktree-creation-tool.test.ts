import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { describe, expect, it, vi } from "vitest";
import { registerWorktreeTools } from "../src/tools/worktree.ts";

function setup() {
  const summary = { id: "wt-1", name: "Draft", state: "draft", unitCount: 0 };
  const service = {
    resolveSpaceForSession: vi.fn().mockResolvedValue({ userId: "user-1", spaceId: "space-1" }),
    createWorktree: vi.fn().mockResolvedValue(summary),
    openDocument: vi.fn().mockResolvedValue({ unitId: "unit-1" }),
    addWorktreeTrunkUnit: vi.fn().mockResolvedValue({ unitId: "unit-1" }),
    getWorktreeDetail: vi.fn().mockResolvedValue({
      ...summary,
      worktreeId: "wt-1",
      status: "draft",
      unitCount: 1,
      units: [{ unitId: "unit-1", resourceId: "res-1" }],
    }),
  };
  let tool: ToolDefinition;
  const ctx = {
    get: () => service,
    on: () => () => undefined,
    tools: { register: (definition: ToolDefinition) => {
      tool = definition;
      return () => undefined;
    } },
  } as unknown as Context;
  registerWorktreeTools(ctx);
  const exec = { agent: { session: { header: { cwd: "/tmp/session" } } } } as ToolRunContext;
  return { service, run: (args: Record<string, unknown>) => tool.execute(args, exec) };
}

describe("Worktree creation tool", () => {
  it("creates an empty draft without creating or opening a trunk document", async () => {
    const { service, run } = setup();
    await expect(run({ action: "create", name: "Draft" })).resolves.toMatchObject({
      id: "wt-1", state: "draft", unitCount: 0,
    });
    expect(service.createWorktree).toHaveBeenCalledWith("user-1", { name: "Draft", summary: null });
    expect(service.openDocument).not.toHaveBeenCalled();
    expect(service.addWorktreeTrunkUnit).not.toHaveBeenCalled();
  });

  it("still verifies and attaches an existing document when resourceId is provided", async () => {
    const { service, run } = setup();
    await expect(run({ action: "create", resourceId: "res-1" })).resolves.toMatchObject({ unitCount: 1 });
    expect(service.openDocument).toHaveBeenCalledWith("user-1", "res-1");
    expect(service.addWorktreeTrunkUnit).toHaveBeenCalledWith("user-1", "wt-1", "res-1");
  });

  it("rejects an explicitly blank resourceId before creating a draft", async () => {
    const { service, run } = setup();
    await expect(run({ action: "create", resourceId: " " })).rejects.toThrow("non-empty resourceId");
    expect(service.createWorktree).not.toHaveBeenCalled();
  });
});
