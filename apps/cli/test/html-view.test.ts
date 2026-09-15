import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKSHEET_ROW_COUNT } from "@univerjs/core";
import type { WorkspaceRuntimeTarget } from "@univerjs/univer-workspace-client-core";
import { workspaceError } from "../src/errors.js";
import { createHtmlViewCommand } from "../src/features/html-view/command.js";
import { WorkspaceHtmlViewFeature } from "../src/features/html-view/html-view.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});
const binding = (unit = "unit", sheet = "budget", cell = "B2") =>
  `<output data-univer-cell-text="${encodeURIComponent(unit)}:${encodeURIComponent(sheet)}:${cell}"></output>`;
const result = { nodeId: "node/1", resourceId: "blob", operationId: "create-key" };
async function setup(html = binding()) {
  const directory = await mkdtemp(join(tmpdir(), "cli-html-view-test-"));
  directories.push(directory);
  const filePath = join(directory, "view.univer.html");
  await writeFile(filePath, html);
  const target: WorkspaceRuntimeTarget = {
    origin: "https://workspace.test",
    scope: { kind: "trunk" },
    unitType: "sheet",
    unitId: "unit",
    revision: 3,
  };
  const resolveTrunkRuntimeTarget = vi.fn(async ({ unitId }: { unitId: string }) => ({
    ...target,
    unitId,
  }));
  const exportUnitData = vi.fn(
    async ({ target: resolved }: { target: WorkspaceRuntimeTarget }) => ({
      id: resolved.unitId,
      name: "Budget",
      appVersion: "1",
      locale: "enUS",
      sheetOrder: ["budget"],
      sheets: { budget: { id: "budget", name: "Budget", rowCount: 10, columnCount: 3 } },
    }),
  );
  const upload = vi.fn(async (_input: { filePath: string }) => result);
  const feature = new WorkspaceHtmlViewFeature({
    blobs: { upload },
    runtime: { exportUnitData } as unknown as ConstructorParameters<
      typeof WorkspaceHtmlViewFeature
    >[0]["runtime"],
    resolveTrunkRuntimeTarget,
    configuredOrigin: async () => "https://workspace.test",
  });
  return {
    feature,
    filePath,
    target,
    resolveTrunkRuntimeTarget,
    exportUnitData,
    upload,
    create: { filePath, name: "Dashboard", spaceId: "space", idempotencyKey: "create-key" },
  };
}

describe("HTML View workflow", () => {
  it("validates each distinct trunk source once and never uploads during validation", async () => {
    const f = await setup(binding() + binding("other") + binding());
    await expect(f.feature.validate(f.filePath)).resolves.toEqual({
      valid: true,
      unitIds: ["unit", "other"],
      bindingCount: 3,
    });
    expect(f.resolveTrunkRuntimeTarget.mock.calls).toEqual([
      [{ unitId: "unit" }],
      [{ unitId: "other" }],
    ]);
    expect(f.exportUnitData).toHaveBeenCalledWith({ target: f.target });
    expect(f.exportUnitData).toHaveBeenCalledTimes(2);
    expect(f.upload).not.toHaveBeenCalled();
  });

  it("decodes Unit and worksheet IDs from binding attributes", async () => {
    const f = await setup(binding("unit:2026", "budget/summer"));
    f.exportUnitData.mockResolvedValue({
      id: "unit:2026",
      sheets: { "budget/summer": { rowCount: 10, columnCount: 3 } },
    } as never);
    await expect(f.feature.validate(f.filePath)).resolves.toMatchObject({ unitIds: ["unit:2026"] });
    expect(f.resolveTrunkRuntimeTarget).toHaveBeenCalledWith({ unitId: "unit:2026" });
  });

  it("accepts JavaScript-only pages without executing scripts or inventing static sources", async () => {
    const f = await setup('<script>throw new Error("must not run")</script>');
    await expect(f.feature.validate(f.filePath)).resolves.toEqual({
      valid: true,
      unitIds: [],
      bindingCount: 0,
    });
    expect(f.resolveTrunkRuntimeTarget).not.toHaveBeenCalled();
  });

  it("uploads the validated bytes, preserves the input filename and cleans up the staging file", async () => {
    const html = "<!DOCTYPE html>\n" + binding();
    const f = await setup(html);
    f.resolveTrunkRuntimeTarget.mockImplementation(async () => {
      await writeFile(f.filePath, "changed during remote validation");
      return f.target;
    });
    let staged = "";
    f.upload.mockImplementation(async (input) => {
      staged = input.filePath;
      expect(await readFile(staged, "utf8")).toBe(html);
      expect((await stat(staged)).mode & 0o777).toBe(0o600);
      expect(input).toMatchObject({
        name: "Dashboard.univer.html",
        spaceId: "space",
        parentNodeId: "folder",
        idempotencyKey: "create-key",
      });
      expect(staged.endsWith("/view.univer.html")).toBe(true);
      return result;
    });
    await expect(f.feature.create({ ...f.create, parentNodeId: "folder" })).resolves.toEqual({
      ...result,
      workspaceUrl: "https://workspace.test/nodes/node%2F1",
    });
    expect(await readFile(f.filePath, "utf8")).toBe("changed during remote validation");
    await expect(stat(dirname(staged))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not duplicate the suffix and points recovery at the author's file after cleanup", async () => {
    const f = await setup();
    let staged = "";
    f.upload.mockImplementation(async (input) => {
      staged = input.filePath;
      expect(input).toMatchObject({ name: "Dashboard.univer.html" });
      throw workspaceError("workspace-result-unknown", "unknown", {
        request: { sourcePath: staged, idempotencyKey: "create-key" },
      });
    });
    await expect(
      f.feature.create({ ...f.create, name: " Dashboard.univer.html " }),
    ).rejects.toMatchObject({
      code: "workspace-result-unknown",
      detail: {
        sourcePath: f.filePath,
        request: { sourcePath: f.filePath, idempotencyKey: "create-key" },
      },
    });
    await expect(stat(dirname(staged))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    binding("unit", "missing"),
    binding("unit", "__proto__"),
    binding("unit", "budget", "D1"),
    binding("unit", "budget", "A11"),
  ])("rejects missing worksheets and out-of-bounds cells before upload (%#)", async (html) => {
    const f = await setup(html);
    await expect(f.feature.create(f.create)).rejects.toMatchObject({
      code: "workspace-html-view-source-invalid",
    });
    expect(f.upload).not.toHaveBeenCalled();
  });

  it("uses the SDK's default worksheet bounds", async () => {
    const f = await setup();
    f.exportUnitData.mockResolvedValue({
      id: "unit",
      sheets: { budget: { id: "budget" } },
    } as never);
    await expect(f.feature.validate(f.filePath)).resolves.toMatchObject({ valid: true });
    await writeFile(f.filePath, binding("unit", "budget", `A${DEFAULT_WORKSHEET_ROW_COUNT + 1}`));
    await expect(f.feature.validate(f.filePath)).rejects.toMatchObject({
      code: "workspace-html-view-source-invalid",
    });
    await writeFile(f.filePath, binding("unit", "budget", "XFD1"));
    await expect(f.feature.validate(f.filePath)).rejects.toMatchObject({
      code: "workspace-html-view-source-invalid",
    });
  });

  it.each([
    [{ unitType: "doc" }, "workspace-unit-type-unsupported"],
    [{ unitId: "wrong" }, "workspace-result-mismatch"],
    [{ scope: { kind: "worktree", worktreeId: "draft" } }, "workspace-result-mismatch"],
  ])("rejects a different type, identity or scope (%#)", async (overrides, code) => {
    const f = await setup();
    f.resolveTrunkRuntimeTarget.mockResolvedValue({
      ...f.target,
      ...overrides,
    } as WorkspaceRuntimeTarget);
    await expect(f.feature.create(f.create)).rejects.toMatchObject({ code });
    expect(f.exportUnitData).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
  });

  it("preserves access failures and refuses mismatched exported data", async () => {
    const f = await setup();
    f.resolveTrunkRuntimeTarget.mockRejectedValueOnce(workspaceError("FORBIDDEN", "Denied"));
    await expect(f.feature.create(f.create)).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.exportUnitData.mockResolvedValue({ id: "wrong", sheets: {} } as never);
    await expect(f.feature.create(f.create)).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
    expect(f.upload).not.toHaveBeenCalled();
  });

  it("rejects malformed bindings and unavailable files before remote access", async () => {
    const f = await setup('<div data-univer-cell-text="invalid"></div>');
    await expect(f.feature.validate(f.filePath)).rejects.toMatchObject({
      code: "workspace-html-view-invalid",
    });
    await expect(f.feature.validate("plain.html")).rejects.toMatchObject({
      code: "workspace-argument-invalid",
    });
    await expect(
      f.feature.validate(join(dirname(f.filePath), "missing.univer.html")),
    ).rejects.toMatchObject({ code: "workspace-html-view-source-unavailable" });
    expect(f.resolveTrunkRuntimeTarget).not.toHaveBeenCalled();
  });

  it.each([
    { name: " " },
    { spaceId: " " },
    { idempotencyKey: " " },
    { parentNodeId: " " },
    { name: "a".repeat(255) },
  ])("rejects invalid destinations before reading sources (%#)", async (overrides) => {
    const f = await setup();
    await expect(f.feature.create({ ...f.create, ...overrides })).rejects.toMatchObject({
      code: "workspace-argument-invalid",
    });
    expect(f.resolveTrunkRuntimeTarget).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
  });
});

describe("HTML View commands", () => {
  async function run(args: string[]) {
    const validate = vi.fn(async () => ({ valid: true, unitIds: ["unit"], bindingCount: 1 }));
    const create = vi.fn(async () => ({
      ...result,
      workspaceUrl: "https://workspace.test/nodes/node%2F1",
    }));
    let output = "";
    const command = createHtmlViewCommand({ validate, create });
    for (const child of command.commands)
      child.exitOverride().configureOutput({
        writeOut: (text) => {
          output += text;
        },
        writeErr: () => {},
      });
    const program = new Command().addCommand(command);
    await program.parseAsync(["html-view", ...args], { from: "user" });
    return { output: JSON.parse(output), validate, create };
  }
  it("maps file validation and explicit creation metadata", async () => {
    const validation = await run(["validate", "--file", "view.univer.html", "--json"]);
    expect(validation.validate).toHaveBeenCalledWith("view.univer.html");
    expect(validation.output).toEqual({ valid: true, unitIds: ["unit"], bindingCount: 1 });
    const creation = await run([
      "create",
      "--file",
      "view.univer.html",
      "--space",
      "space",
      "--parent",
      "folder",
      "--name",
      "Dashboard",
      "--idempotency-key",
      "key",
      "--json",
    ]);
    expect(creation.create).toHaveBeenCalledWith({
      filePath: "view.univer.html",
      spaceId: "space",
      parentNodeId: "folder",
      name: "Dashboard",
      idempotencyKey: "key",
    });
    expect(creation.output.workspaceUrl).toBe("https://workspace.test/nodes/node%2F1");
  });
  it.each(["--file", "--space", "--name", "--idempotency-key"])(
    "requires %s for creation",
    async (missing) => {
      const pairs = [
        ["--file", "view.univer.html"],
        ["--space", "space"],
        ["--name", "Dashboard"],
        ["--idempotency-key", "key"],
      ];
      await expect(
        run(["create", ...pairs.filter(([flag]) => flag !== missing).flat()]),
      ).rejects.toMatchObject({ code: "commander.missingMandatoryOptionValue" });
    },
  );
});
