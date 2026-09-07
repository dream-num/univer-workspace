import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { describe, expect, it, vi } from "vitest";
import { registerUnitTool } from "../src/tools/unit.ts";

function setup() {
  const service = {
    resolveSpaceForSession: vi.fn().mockResolvedValue({ userId: "user-1", spaceId: "space-1" }),
    createWorktreeLocalUnit: vi.fn().mockResolvedValue({ unitId: "new-unit" }),
    setWorktreeUnitRemoved: vi.fn().mockResolvedValue({ unitId: "unit-1", change: "deleted" }),
  };
  let tool: ToolDefinition;
  const ctx = {
    get: () => service,
    on: () => () => undefined,
    tools: {
      register: (value: ToolDefinition) => {
        tool = value;
        return () => undefined;
      },
    },
  } as unknown as Context;
  registerUnitTool(ctx);
  const exec = { agent: { session: { header: { cwd: "/tmp/session" } } } } as ToolRunContext;
  return { service, run: (args: Record<string, unknown>) => tool.execute(args, exec) };
}

describe("Unit deletion tool", () => {
  it.each(["remove", "restore"])(
    "%s needs Unit identity without creation fields",
    async (action) => {
      const { service, run } = setup();
      await run({ action, worktreeId: "wt-1", unitId: "unit-1" });
      expect(service.setWorktreeUnitRemoved).toHaveBeenCalledWith(
        "user-1",
        "wt-1",
        "unit-1",
        action === "remove",
      );
      expect(service.createWorktreeLocalUnit).not.toHaveBeenCalled();
    },
  );

  it("rejects missing Unit identity before changing deletion intent", async () => {
    const { service, run } = setup();
    await expect(run({ action: "remove", worktreeId: "wt-1" })).rejects.toThrow("requires unitId");
    expect(service.setWorktreeUnitRemoved).not.toHaveBeenCalled();
  });

  it("still requires creation fields for create", async () => {
    const { service, run } = setup();
    await expect(run({ action: "create", worktreeId: "wt-1" })).rejects.toThrow(
      "requires unitType",
    );
    expect(service.createWorktreeLocalUnit).not.toHaveBeenCalled();
  });
});
