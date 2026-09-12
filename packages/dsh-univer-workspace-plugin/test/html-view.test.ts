import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerHtmlViewTool } from "../src/tools/html-view.ts";

function fixture(unitId: string, sheetId: string) {
  return `<output data-univer-cell-text="${unitId}:${sheetId}:B2"></output>`;
}

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function setup(html = fixture("unit", "budget")) {
  const cwd = await mkdtemp(join(tmpdir(), "html-view-"));
  directories.push(cwd);
  await writeFile(join(cwd, "view.univer.html"), html);
  const service = {
    resolveSpaceForSession: vi.fn().mockResolvedValue({ userId: "user", spaceId: "space" }),
    resolveUnitResource: vi
      .fn()
      .mockResolvedValue({ unitId: "unit", unitType: "sheet", editorMode: "edit" }),
    exportUnitData: vi.fn().mockResolvedValue({
      sheetOrder: ["budget"],
      sheets: { budget: { rowCount: 10, columnCount: 3 } },
    }),
    uploadBlob: vi
      .fn()
      .mockResolvedValue({ nodeId: "view", workspaceUrl: "https://workspace.test/nodes/view" }),
  };
  let tool: ToolDefinition;
  registerHtmlViewTool({
    get: () => service,
    on: () => () => undefined,
    tools: {
      register: (value: ToolDefinition) => {
        tool = value;
        return () => undefined;
      },
    },
  } as unknown as Context);
  const abort = new AbortController();
  const exec = { agent: { session: { header: { cwd } } }, signal: abort.signal } as ToolRunContext;
  return { service, abort, run: (args: Record<string, unknown>) => tool.execute(args, exec) };
}

describe("HTML view Agent tool", () => {
  it("validates Unit references and publishes only a separate Blob", async () => {
    const { run, service } = await setup();
    await expect(run({ action: "validate", source: "view.univer.html" })).resolves.toMatchObject({
      valid: true,
      unitIds: ["unit"],
    });
    await run({
      action: "create",
      source: "view.univer.html",
      name: "Dashboard",
      idempotencyKey: "retry-1",
    });
    expect(service.resolveUnitResource).toHaveBeenCalledWith("user", "unit");
    expect(service.exportUnitData).toHaveBeenCalledWith("user", {
      scope: { kind: "trunk" },
      unitId: "unit",
      unitType: "sheet",
    });
    expect(service.uploadBlob).toHaveBeenCalledWith(
      "user",
      expect.objectContaining({
        spaceId: "space",
        idempotencyKey: "retry-1",
        bytes: new TextEncoder().encode(fixture("unit", "budget")),
        declaredMediaType: "text/html",
      }),
    );
  });

  it("rejects missing worksheets, out of bounds cells and path escapes before upload", async () => {
    const { run, service } = await setup(fixture("unit", "missing"));
    await expect(run({ action: "create", source: "view.univer.html" })).rejects.toThrow(
      "worksheet not found",
    );
    await expect(run({ action: "validate", source: "../outside.html" })).rejects.toThrow();
    expect(service.uploadBlob).not.toHaveBeenCalled();
    const other = await setup(fixture("unit", "budget").replace(":B2", ":D20"));
    await expect(other.run({ action: "validate", source: "view.univer.html" })).rejects.toThrow(
      "outside the worksheet",
    );
  });
  it("stops before uploading when source access is denied", async () => {
    const { run, service } = await setup();
    service.resolveUnitResource.mockRejectedValue(new Error("Access denied"));
    await expect(
      run({
        action: "create",
        source: "view.univer.html",
        name: "Dashboard",
        idempotencyKey: "retry-1",
      }),
    ).rejects.toThrow("Access denied");
    expect(service.uploadBlob).not.toHaveBeenCalled();
  });
});
it("rejects inherited worksheet keys instead of treating them as real sheets", async () => {
  const { run } = await setup(fixture("unit", "constructor"));
  await expect(run({ action: "validate", source: "view.univer.html" })).rejects.toThrow(
    "worksheet not found",
  );
});
it("does not publish after the Agent task is cancelled", async () => {
  const { service, run, abort } = await setup();
  const snapshot = await service.exportUnitData();
  service.exportUnitData.mockImplementation(async () => {
    abort.abort(new Error("Task cancelled"));
    return snapshot;
  });
  await expect(
    run({ action: "create", source: "view.univer.html", name: "View", idempotencyKey: "key" }),
  ).rejects.toThrow("Task cancelled");
  expect(service.uploadBlob).not.toHaveBeenCalled();
});
