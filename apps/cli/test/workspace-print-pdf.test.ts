import type { WorkspacePrintPdfApplication } from "@univerjs/univer-workspace-client-core";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { createWorkspacePrintPdfCommand } from "../src/features/print-pdf/command.js";

describe("Workspace print-pdf command", () => {
  it.each([
    [["--trunk"], { kind: "trunk" }],
    [["--worktree", "wt-1"], { kind: "worktree", worktreeId: "wt-1" }],
  ] as const)("prints the selected Workspace scope %#", async (scopeArgs, scope) => {
    const application = printApplication();
    const { program, stdout } = programWith(application);

    await program.parseAsync(
      ["print-pdf", "reports/book.pdf", ...scopeArgs, "--unit", "book-1", "--json"],
      { from: "user" },
    );

    expect(application.print).toHaveBeenCalledWith({
      destination: "reports/book.pdf",
      scope,
      unitId: "book-1",
    });
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      location: "/workspace/reports/book.pdf",
      pageCount: 2,
      unitId: "book-1",
      unitType: "sheet",
    });
  });

  it("prints only the output path in human-readable mode", async () => {
    const { program, stdout } = programWith(printApplication());

    await program.parseAsync(["print-pdf", "book.pdf", "--trunk", "--unit", "book-1"], {
      from: "user",
    });

    expect(stdout.join("")).toBe("/workspace/reports/book.pdf\n");
  });

  it("rejects a request without an explicit Workspace scope", async () => {
    const application = printApplication();
    const { program } = programWith(application);

    await expect(
      program.parseAsync(["print-pdf", "book.pdf", "--unit", "book-1"], { from: "user" }),
    ).rejects.toThrow();
    expect(application.print).not.toHaveBeenCalled();
  });
});

function programWith(application: WorkspacePrintPdfApplication): {
  readonly program: Command;
  readonly stdout: string[];
} {
  const stdout: string[] = [];
  const program = new Command("test");
  program.configureOutput({ writeOut: (text) => stdout.push(text), writeErr: () => undefined });
  program.exitOverride();
  const command = createWorkspacePrintPdfCommand(application);
  command.configureOutput(program.configureOutput());
  program.addCommand(command);
  return { program, stdout };
}

function printApplication(): WorkspacePrintPdfApplication {
  return {
    print: vi.fn<WorkspacePrintPdfApplication["print"]>(async () => ({
      location: "/workspace/reports/book.pdf",
      ok: true,
      pageCount: 2,
      unitId: "book-1",
      unitType: "sheet",
    })),
  };
}
