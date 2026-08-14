import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonValue } from "@univer-cli/daemon";
import type { UnitScreenshotInput, UnitScreenshotResult } from "@univer-cli/unit-screenshot";
import type { UniverRenderRuntime, UniverRenderUnit } from "@univer-cli/univer-render-runtime";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceScreenshotCommand } from "../src/features/screenshot/command.js";
import {
  WorkspaceScreenshotFeature,
  type WorkspaceScreenshotApplication,
} from "../src/features/screenshot/screenshot.js";
import type { WorkspaceRuntimeTarget } from "../src/runtime/target.js";
import { UNIVER_LICENSE } from "../src/license.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path) => await rm(path, { recursive: true })),
  );
});

describe("Workspace screenshot feature", () => {
  it("exports the Host and its Worktree/trunk formula reference Units", async () => {
    const host = target("host", "board", { kind: "worktree", worktreeId: "wt-1" });
    const sheet = target("source-sheet", "sheet", { kind: "worktree", worktreeId: "wt-1" });
    const base = target("source-base", "base", { kind: "trunk" });
    const resolveReferencedRuntimeTarget = vi.fn(async ({ unitId }: { unitId: string }) =>
      unitId === sheet.unitId ? sheet : base,
    );
    const request = vi.fn(async (_method: string, payload: JsonValue): Promise<JsonValue> => {
      const unitId = (payload as { target: { unitId: string } }).target.unitId;
      if (unitId === host.unitId) {
        return {
          id: host.unitId,
          resources: [
            {
              name: "UNIVER_EXTERNAL_REFERENCE_PLUGIN",
              data: JSON.stringify({
                references: {
                  z: { sourceUnitId: base.unitId },
                  a: { sourceUnitId: sheet.unitId },
                },
              }),
            },
          ],
        };
      }
      return { id: unitId };
    });
    const feature = new WorkspaceScreenshotFeature({
      browserRuntimeRoot: "/render-runtime",
      daemon: { request },
      env: {},
      openSource: async () => ({
        resolveImageAsset: async () => undefined,
        resolveReferencedRuntimeTarget,
        resolveRuntimeTarget: async () => host,
        resolveTrunkRuntimeTarget: async () => host,
      }),
    });

    const loaded = await feature.loadUnit({
      scope: { kind: "worktree", worktreeId: "wt-1" },
      unitId: host.unitId,
    });

    expect(loaded).toMatchObject({
      unitType: "board",
      unitData: { id: "host" },
      formulaReferenceUnits: [
        { unitType: "base", unitData: { id: "source-base" } },
        { unitType: "sheet", unitData: { id: "source-sheet" } },
      ],
    });
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      "runtime.export-unit-data",
      "runtime.export-unit-data",
      "runtime.export-unit-data",
    ]);
    expect(resolveReferencedRuntimeTarget).toHaveBeenCalledTimes(2);
  });

  it("exports active Embed child Units and ignores soft-deleted descriptors", async () => {
    const host = target("host-slide", "slide", { kind: "worktree", worktreeId: "wt-1" });
    const child = target("child-sheet", "sheet", { kind: "worktree", worktreeId: "wt-1" });
    const resolveReferencedRuntimeTarget = vi.fn(async () => child);
    const request = vi.fn(async (_method: string, payload: JsonValue): Promise<JsonValue> => {
      const unitId = (payload as { target: { unitId: string } }).target.unitId;
      if (unitId === host.unitId) {
        return {
          id: host.unitId,
          resources: [
            {
              name: "UNIVER_EMBED_RESOURCE_PLUGIN",
              data: JSON.stringify({
                version: 1,
                embeds: {
                  active: {
                    childUnitId: child.unitId,
                    lifecycle: "active",
                    source: {
                      ref: {
                        file: { kind: "self" },
                        unit: { selector: child.unitId, type: "sheet" },
                      },
                    },
                  },
                  deleted: { childUnitId: "deleted-doc", lifecycle: "soft-deleted" },
                },
              }),
            },
          ],
        };
      }
      return { id: unitId };
    });
    const feature = new WorkspaceScreenshotFeature({
      browserRuntimeRoot: "/render-runtime",
      daemon: { request },
      env: {},
      openSource: async () => ({
        resolveImageAsset: async () => undefined,
        resolveReferencedRuntimeTarget,
        resolveRuntimeTarget: async () => host,
        resolveTrunkRuntimeTarget: async () => host,
      }),
    });

    await expect(
      feature.loadUnit({ scope: host.scope, unitId: host.unitId }),
    ).resolves.toMatchObject({
      unitType: "slide",
      embeddedUnits: [{ unitType: "sheet", unitData: { id: child.unitId } }],
    });
    expect(resolveReferencedRuntimeTarget).toHaveBeenCalledWith({
      hostTarget: host,
      unitId: child.unitId,
    });
  });

  it("resolves Worktree image assets for Host, formula reference, and Embed render data", async () => {
    const host = target("host", "board", { kind: "worktree", worktreeId: "wt-1" });
    const formula = target("formula", "sheet", { kind: "worktree", worktreeId: "wt-1" });
    const child = target("child", "slide", { kind: "worktree", worktreeId: "wt-1" });
    const serialized = JSON.stringify({
      drawing: { imageSourceType: "UUID", source: "asset-shared" },
    });
    const request = vi.fn(async (_method: string, payload: JsonValue): Promise<JsonValue> => {
      const unitId = (payload as { target: { unitId: string } }).target.unitId;
      if (unitId === host.unitId) {
        return {
          id: unitId,
          resources: [
            {
              data: JSON.stringify({ references: { formula: { sourceUnitId: formula.unitId } } }),
              name: "UNIVER_EXTERNAL_REFERENCE_PLUGIN",
            },
            {
              data: JSON.stringify({
                embeds: { child: { childUnitId: child.unitId, lifecycle: "active" } },
              }),
              name: "UNIVER_EMBED_RESOURCE_PLUGIN",
            },
            { data: serialized, name: "SHEET_DRAWING_PLUGIN" },
          ],
        };
      }
      if (unitId === formula.unitId) {
        return { id: unitId, drawing: { imageSourceType: "UUID", source: "asset-shared" } };
      }
      return { id: unitId, image: { imageSourceType: "UUID", source: "asset-child" } };
    });
    const resolveImageAsset = vi.fn(async ({ assetId }: { assetId: string }) => ({
      bytes: Uint8Array.from([assetId.length]),
      contentLength: 1,
      mediaType: "image/png",
    }));
    const feature = new WorkspaceScreenshotFeature({
      browserRuntimeRoot: "/render-runtime",
      daemon: { request },
      env: {},
      openSource: async () => ({
        resolveImageAsset,
        resolveReferencedRuntimeTarget: async ({ unitId }) =>
          unitId === formula.unitId ? formula : child,
        resolveRuntimeTarget: async () => host,
        resolveTrunkRuntimeTarget: async () => host,
      }),
    });

    const loaded = await feature.loadUnit({ scope: host.scope, unitId: host.unitId });

    expect(resolveImageAsset).toHaveBeenCalledTimes(2);
    expect(resolveImageAsset.mock.calls.map(([input]) => input)).toEqual(
      expect.arrayContaining([
        { assetId: "asset-child", worktreeId: "wt-1" },
        { assetId: "asset-shared", worktreeId: "wt-1" },
      ]),
    );
    const hostResource = (
      loaded.unitData as unknown as { resources: Array<{ data: string; name: string }> }
    ).resources.find(({ name }) => name === "SHEET_DRAWING_PLUGIN");
    expect(JSON.parse(hostResource!.data)).toMatchObject({
      drawing: { imageSourceType: "BASE64", source: "data:image/png;base64,DA==" },
    });
    expect(loaded.formulaReferenceUnits?.[0]?.unitData).toMatchObject({
      drawing: { imageSourceType: "BASE64", source: "data:image/png;base64,DA==" },
    });
    expect(loaded.embeddedUnits?.[0]?.unitData).toMatchObject({
      image: { imageSourceType: "BASE64", source: "data:image/png;base64,Cw==" },
    });
  });

  it("creates and closes one browser runtime per capture", async () => {
    const close = vi.fn(async () => undefined);
    const runtime = {
      close,
      composeContactSheet: vi.fn(),
      getDocumentPageCount: vi.fn(),
      render: vi.fn(async () => ({ bytes: Uint8Array.from([1, 2, 3]), height: 20, width: 30 })),
    } as unknown as UniverRenderRuntime;
    const createRuntime = vi.fn(async () => runtime);
    const feature = featureWith({ createRuntime, env: {} });

    await expect(
      feature.capture({
        unitType: "sheet",
        unitData: sheetData(),
      }),
    ).resolves.toMatchObject({ unitId: "book-1", unitType: "sheet" });
    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        browserRuntimeRoot: "/render-runtime",
        license: UNIVER_LICENSE,
      }),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("writes PNGs to an explicit directory without replacing existing files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workspace-screenshot-"));
    temporaryDirectories.push(directory);
    const feature = featureWith({ cwd: directory });
    const result = screenshotResult();

    await expect(feature.writeImages({ destination: "shots", result })).resolves.toEqual([
      { location: join(directory, "shots", "view.png"), name: "view.png" },
    ]);
    await expect(readFile(join(directory, "shots", "view.png"))).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );
    await expect(feature.writeImages({ destination: "shots", result })).rejects.toMatchObject({
      code: "workspace-screenshot-output-exists",
    });
  });
});

describe("Workspace screenshot command", () => {
  it("adds Workspace scope options around the target-neutral preset", async () => {
    const result = screenshotResult();
    const application: WorkspaceScreenshotApplication = {
      capture: vi.fn(async () => result),
      loadUnit: vi.fn(
        async (): Promise<UniverRenderUnit> => ({ unitType: "sheet", unitData: sheetData() }),
      ),
      writeImages: vi.fn(async () => [{ location: "/shots/view.png", name: "view.png" }]),
    };
    const program = new Command("test");
    program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    program.exitOverride();
    const command = createWorkspaceScreenshotCommand({
      browserSetup: {
        install: vi.fn(),
        probe: vi.fn(),
        resolve: vi.fn(),
      },
      env: {},
      screenshot: application,
    });
    command.configureOutput(program.configureOutput());
    program.addCommand(command);

    await program.parseAsync(["screenshot", "--trunk", "--unit", "book-1"], { from: "user" });

    expect(application.loadUnit).toHaveBeenCalledWith({
      scope: { kind: "trunk" },
      unitId: "book-1",
    });
  });
});

function featureWith(
  overrides: Partial<ConstructorParameters<typeof WorkspaceScreenshotFeature>[0]> = {},
): WorkspaceScreenshotFeature {
  return new WorkspaceScreenshotFeature({
    browserRuntimeRoot: "/render-runtime",
    daemon: { request: vi.fn() },
    env: {},
    openSource: vi.fn(),
    ...overrides,
  });
}

function target(
  unitId: string,
  unitType: WorkspaceRuntimeTarget["unitType"],
  scope: WorkspaceRuntimeTarget["scope"],
): WorkspaceRuntimeTarget {
  return { origin: "https://workspace.test", revision: 1, scope, unitId, unitType };
}

function screenshotResult(): UnitScreenshotResult {
  return {
    images: [
      {
        bytes: Uint8Array.from([1, 2, 3]),
        height: 20,
        mediaType: "image/png",
        name: "view.png",
        width: 30,
      },
    ],
    unitId: "book-1",
    unitType: "sheet",
  };
}

function sheetData(): Extract<UnitScreenshotInput, { unitType: "sheet" }>["unitData"] {
  return {
    id: "book-1",
    name: "Book",
    sheetOrder: ["sheet-1"],
    sheets: {
      "sheet-1": { id: "sheet-1", name: "Sheet1", rowCount: 1, columnCount: 1 },
    },
  } as unknown as Extract<UnitScreenshotInput, { unitType: "sheet" }>["unitData"];
}
