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
    uploadBlob: vi.fn().mockResolvedValue({
      operationId: "html-view-request-0001",
      uploadId: "upload",
      nodeId: "view",
      resourceId: "blob",
    }),
  };
  let tool: ToolDefinition;
  registerHtmlViewTool({
    get: (name: string) =>
      name === "workspaceAuth" ? { effectiveOrigin: () => "https://workspace.test" } : service,
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
  it("rejects a short create key with actionable guidance before uploading", async () => {
    const { run, service } = await setup();
    await expect(
      run({
        action: "create",
        source: "view.univer.html",
        name: "Join",
        idempotencyKey: "salon-join-v1",
      }),
    ).rejects.toThrow(/idempotencyKey must contain 16–200/);
    expect(service.uploadBlob).not.toHaveBeenCalled();
  });

  it("validates Unit references and publishes only a separate Blob", async () => {
    const { run, service } = await setup();
    await expect(run({ action: "validate", source: "view.univer.html" })).resolves.toMatchObject({
      valid: true,
      unitIds: ["unit"],
    });
    await expect(
      run({
        action: "create",
        source: "view.univer.html",
        name: "Dashboard",
        idempotencyKey: "html-view-request-0001",
      }),
    ).resolves.toMatchObject({
      nodeId: "view",
      resourceId: "blob",
      workspaceUrl: "https://workspace.test/nodes/view",
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
        idempotencyKey: "html-view-request-0001",
        bytes: new TextEncoder().encode(fixture("unit", "budget")),
        name: "Dashboard.univer.html",
        originalFilename: "Dashboard.univer.html",
        parentNodeId: null,
      }),
    );
  });

  it("validates cell and range declarations and publishes the exact template", async () => {
    const html = `<output id="metric" data-univer-cell-subscribe="unit:budget:B2"></output>
      <div id="chart" data-univer-range-subscribe="unit:budget:A1:C10"></div>`;
    const { run, service } = await setup(html);
    await expect(run({ action: "validate", source: "view.univer.html" })).resolves.toEqual({
      valid: true,
      unitIds: ["unit"],
      bindingCount: 2,
    });
    expect(service.exportUnitData).toHaveBeenCalledTimes(1);
    await run({
      action: "create",
      source: "view.univer.html",
      name: "Chart",
      idempotencyKey: "html-view-request-0002",
    });
    expect(service.uploadBlob).toHaveBeenCalledWith(
      "user",
      expect.objectContaining({
        bytes: new TextEncoder().encode(html),
      }),
    );
  });

  it.each(["A1:C11", "A1:D10", "D11:E12"])(
    "rejects out-of-bounds subscribed ranges before upload (%s)",
    async (range) => {
      const { run, service } = await setup(
        `<div id="chart" data-univer-range-subscribe="unit:budget:${range}"></div>`,
      );
      await expect(
        run({
          action: "create",
          source: "view.univer.html",
          name: "Chart",
          idempotencyKey: "html-view-request-0002",
        }),
      ).rejects.toThrow("outside the worksheet");
      expect(service.uploadBlob).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing range worksheet before upload", async () => {
    const { run, service } = await setup(
      '<div id="chart" data-univer-range-subscribe="unit:missing:A1:B2"></div>',
    );
    await expect(
      run({
        action: "create",
        source: "view.univer.html",
        name: "Chart",
        idempotencyKey: "html-view-request-0002",
      }),
    ).rejects.toThrow("worksheet not found");
    expect(service.uploadBlob).not.toHaveBeenCalled();
  });

  it.each(["A1", "C10:A1", "A0:B2"])(
    "rejects malformed subscribed ranges before remote access (%s)",
    async (range) => {
      const { run, service } = await setup(
        `<div id="chart" data-univer-range-subscribe="unit:budget:${range}"></div>`,
      );
      await expect(run({ action: "validate", source: "view.univer.html" })).rejects.toThrow();
      expect(service.resolveUnitResource).not.toHaveBeenCalled();
    },
  );

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
        idempotencyKey: "html-view-request-0001",
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
    run({
      action: "create",
      source: "view.univer.html",
      name: "View",
      idempotencyKey: "html-view-request-0002",
    }),
  ).rejects.toThrow("Task cancelled");
  expect(service.uploadBlob).not.toHaveBeenCalled();
});

it("accepts JavaScript-only pages without inventing static Unit references", async () => {
  const { run, service } = await setup(
    "<script>window.univerBinding.getCellState(reference)</script>",
  );
  await expect(run({ action: "validate", source: "view.univer.html" })).resolves.toMatchObject({
    valid: true,
    unitIds: [],
    bindingCount: 0,
  });
  expect(service.resolveUnitResource).not.toHaveBeenCalled();
});
