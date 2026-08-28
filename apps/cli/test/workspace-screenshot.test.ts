import type { WorkspaceScreenshotApplication } from "@univerjs/univer-workspace-client-core";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceScreenshotCommand } from "../src/features/screenshot/command.js";

describe("Workspace screenshot command", () => {
  it.each([
    [["--trunk"], { kind: "trunk" }],
    [["--worktree", "wt-1"], { kind: "worktree", worktreeId: "wt-1" }],
  ] as const)("maps the Workspace scope around the target-neutral preset %#", async (scopeArgs, scope) => {
    const application = screenshotApplication();
    const program = programWith(application);

    await program.parseAsync(["screenshot", ...scopeArgs, "--unit", "book-1"], { from: "user" });

    expect(application.loadUnit).toHaveBeenCalledWith({ scope, unitId: "book-1" });
  });

  it("rejects a screenshot without an explicit Workspace scope", async () => {
    const application = screenshotApplication();

    await expect(
      programWith(application).parseAsync(["screenshot", "--unit", "book-1"], { from: "user" }),
    ).rejects.toThrow('process.exit unexpectedly called with "1"');
    expect(application.capture).not.toHaveBeenCalled();
  });
});

function programWith(application: WorkspaceScreenshotApplication): Command {
  const program = new Command("test");
  program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
  program.exitOverride();
  const command = createWorkspaceScreenshotCommand({
    browserSetup: { install: vi.fn(), probe: vi.fn(), resolve: vi.fn() },
    env: {},
    screenshot: application,
  });
  command.configureOutput(program.configureOutput());
  return program.addCommand(command);
}

function screenshotApplication(): WorkspaceScreenshotApplication {
  const capture = vi.fn<WorkspaceScreenshotApplication["capture"]>(async () => ({
    images: [],
    unitId: "book-1",
    unitType: "sheet",
  }));
  const loadUnit = vi.fn<WorkspaceScreenshotApplication["loadUnit"]>(async () => ({
    unitType: "sheet",
    unitData: { id: "book-1", name: "Book", sheetOrder: [], sheets: {} },
  }) as never);
  return {
    capture,
    loadUnit,
    writeImages: vi.fn(async () => []),
  };
}
