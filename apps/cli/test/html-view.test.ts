import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKSHEET_ROW_COUNT } from "@univerjs/core";
import { WorkspaceHttp } from "@univerjs/univer-workspace-client-core";
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
async function setup(html = binding(), publicRead = false, privateUnits: readonly string[] = []) {
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
    authenticatedHttp: async () => sharingHttp(publicRead, privateUnits),
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
      bindings: ["unit", "other", "unit"].map((unitId) => ({ kind: "text", unitId, sheet: "Budget", ref: "B2", cell: { value: null } })),
    });
    expect(f.resolveTrunkRuntimeTarget.mock.calls).toEqual([
      [{ unitId: "unit" }],
      [{ unitId: "other" }],
    ]);
    expect(f.exportUnitData).toHaveBeenCalledWith({ target: f.target });
    expect(f.exportUnitData).toHaveBeenCalledTimes(2);
    expect(f.upload).not.toHaveBeenCalled();
  });

  it("validates cell and range subscription declarations against distinct trunk sources", async () => {
    const f = await setup(`
      <output id="metric" data-univer-cell-subscribe="unit:budget:B2"></output>
      <div id="chart" data-univer-range-subscribe="other:budget:A1:C10"></div>
      <div id="list" data-univer-range-subscribe="other:budget:B2:B2"></div>
    `);
    await expect(f.feature.validate(f.filePath)).resolves.toEqual({
      valid: true,
      unitIds: ["unit", "other"],
      bindingCount: 3,
      bindings: [
        { kind: "cell", unitId: "unit", sheet: "Budget", ref: "B2", cell: { value: null } },
        { kind: "range", unitId: "other", sheet: "Budget", ref: "A1:C10", range: {
          rows: 10, columns: 3, filledRows: 0,
          head: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ value: null }))),
        } },
        { kind: "range", unitId: "other", sheet: "Budget", ref: "B2:B2", range: {
          rows: 1, columns: 1, filledRows: 0, head: [[{ value: null }]],
        } },
      ],
    });
    expect(f.exportUnitData).toHaveBeenCalledTimes(2);
    expect(f.upload).not.toHaveBeenCalled();
  });

  it.each(["A1:C11", "A1:D10", "D11:E12"])(
    "rejects out-of-bounds subscribed ranges before upload (%s)",
    async (range) => {
      const f = await setup(
        `<div id="chart" data-univer-range-subscribe="unit:budget:${range}"></div>`,
      );
      await expect(f.feature.create(f.create)).rejects.toMatchObject({
        code: "workspace-html-view-source-invalid",
      });
      expect(f.upload).not.toHaveBeenCalled();
    },
  );

  it.each(["A1", "C10:A1", "A0:B2"])(
    "rejects malformed subscribed ranges before remote access (%s)",
    async (range) => {
      const f = await setup(
        `<div id="chart" data-univer-range-subscribe="unit:budget:${range}"></div>`,
      );
      await expect(f.feature.validate(f.filePath)).rejects.toMatchObject({
        code: "workspace-html-view-invalid",
      });
      expect(f.resolveTrunkRuntimeTarget).not.toHaveBeenCalled();
    },
  );

  it("decodes Unit and worksheet IDs from binding attributes", async () => {
    const f = await setup(
      binding("unit:2026", "budget/summer") +
        '<div id="chart" data-univer-range-subscribe="unit%3A2026:budget%2Fsummer:A1:C10"></div>',
    );
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
      bindings: [],
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
      shareUrl: "https://workspace.test/nodes/node%2F1?view=immersive",
      repositoryVisibility: "private" as const,
      privateSourceUnitIds: ["unit"],
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
    '<div id="chart" data-univer-range-subscribe="unit:missing:A1:C10"></div>',
    '<div id="metric" data-univer-cell-subscribe="unit:budget:D1"></div>',
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
  async function run(args: string[], repositoryVisibility: "public" | "private" = "private", privateSourceUnitIds = ["unit"]) {
    const validate = vi.fn(async () => ({
      valid: true as const,
      unitIds: ["unit"],
      bindingCount: 1,
      bindings: [{ kind: "text" as const, unitId: "unit", sheet: "Budget", ref: "B2", cell: { value: 46357, format: "yyyy-mm" } }],
    }));
    const create = vi.fn(async () => ({
      ...result,
      workspaceUrl: "https://workspace.test/nodes/node%2F1",
      shareUrl: "https://workspace.test/nodes/node%2F1?view=immersive",
      repositoryVisibility,
      privateSourceUnitIds,
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
    expect(validation.output).toEqual({ valid: true, unitIds: ["unit"], bindingCount: 1,
      bindings: [{ kind: "text", unitId: "unit", sheet: "Budget", ref: "B2", cell: { value: 46357, format: "yyyy-mm" } }],
    });
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
  it.each([
    { visibility: "public" as const, privateUnits: [] },
    { visibility: "private" as const, privateUnits: ["unit"] },
    { visibility: "public" as const, privateUnits: ["unit"] },
  ])("prints sharing fields for $visibility with private sources $privateUnits", async ({ visibility, privateUnits }) => {
    for (const mode of [[], ["--json"]]) {
      const creation = await run(["create", "--file", "view.univer.html", "--space", "space", "--name", "View", "--idempotency-key", "key", ...mode], visibility, privateUnits);
      expect(creation.output).toMatchObject({ shareUrl: "https://workspace.test/nodes/node%2F1?view=immersive", repositoryVisibility: visibility, privateSourceUnitIds: privateUnits });
    }
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

function sharingHttp(publicRead = false, privateUnits: readonly string[] = []) {
  return new WorkspaceHttp({
    origin: "https://workspace.test",
    role: "client",
    cookie: "workspace_session=test",
    fetcher: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.startsWith("/api/spaces/")) {
        const id = path.split("/").at(-1);
        return Response.json({ id, name: "Team", publicRead: id === "private" ? false : publicRead });
      }
      const unitId = decodeURIComponent(path.split("/").at(-1) ?? "");
      return Response.json({ node: {
        id: "source-node", spaceId: privateUnits.includes(unitId) ? "private" : "space",
        parentNodeId: null, name: "Sheet", hasChildren: false, updatedAt: "now", accessRole: "owner",
        capabilities: { browseChildren: false, createChildren: false, rename: true, move: true, trash: true, share: true },
        resource: { id: "sheet-resource", kind: "univer", unitId, unitType: "sheet",
          capabilities: { downloadContent: true, editContent: true, openContent: true } },
      } });
    },
  });
}

it.each([
  { publicRead: true, privateUnits: [], visibility: "public", expected: [] },
  { publicRead: false, privateUnits: [], visibility: "private", expected: ["unit"] },
  { publicRead: true, privateUnits: ["unit"], visibility: "public", expected: ["unit"] },
])("CLI workflow reports sharing for $visibility with private sources $privateUnits", async ({ publicRead, privateUnits, visibility, expected }) => {
  const f = await setup(binding(), publicRead, privateUnits);
  await expect(f.feature.create(f.create)).resolves.toMatchObject({ shareUrl: "https://workspace.test/nodes/node%2F1?view=immersive", repositoryVisibility: visibility, privateSourceUnitIds: expected });
});
