import type { ScreenshotImageAsset } from "@univer-cli/unit-screenshot";
import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceRenderUnitLoader,
  type WorkspaceRenderUnitSource,
  type WorkspaceRuntimeTarget,
} from "../src/index.js";

describe("Workspace render Unit loader", () => {
  it("loads formula references in lexical order with trim, deduplication, and self exclusion", async () => {
    const host = target("host", "board", { kind: "worktree", worktreeId: "wt-1" });
    const sourceTargets = new Map([
      ["source-base", target("source-base", "base", { kind: "trunk" })],
      ["source-sheet", target("source-sheet", "sheet", host.scope)],
    ]);
    const hostData = Object.freeze({
      id: host.unitId,
      resources: [
        externalReferences({
          z: { sourceUnitId: " source-sheet " },
          a: { sourceUnitId: "source-base" },
          duplicate: { sourceUnitId: "source-sheet" },
          self: { sourceUnitId: "host" },
        }),
      ],
    });
    const exportUnitData = vi.fn(async ({ target }: { target: WorkspaceRuntimeTarget }) =>
      target.unitId === host.unitId ? hostData : Object.freeze({ id: target.unitId }),
    );
    const resolveReferencedRuntimeTarget = vi.fn(
      async ({ unitId }: { unitId: string }) => sourceTargets.get(unitId)!,
    );
    const loader = loaderWith({
      exportUnitData,
      source: sourceWith(host, { resolveReferencedRuntimeTarget }),
    });

    await expect(loader.loadUnit({ scope: host.scope, unitId: " host " })).resolves.toEqual({
      unitType: "board",
      unitData: hostData,
      formulaReferenceUnits: [
        { unitType: "base", unitData: { id: "source-base" } },
        { unitType: "sheet", unitData: { id: "source-sheet" } },
      ],
    });
    expect(resolveReferencedRuntimeTarget.mock.calls.map(([input]) => input)).toEqual([
      { hostTarget: host, unitId: "source-base" },
      { hostTarget: host, unitId: "source-sheet" },
    ]);
    expect(exportUnitData.mock.calls.map(([input]) => input.target.unitId)).toEqual([
      "host",
      "source-base",
      "source-sheet",
    ]);
  });

  it.each(["doc", "slide", "board"] as const)(
    "rejects a %s formula source before exporting it",
    async (unitType) => {
      const host = target("host", "sheet", { kind: "trunk" });
      const exportUnitData = vi.fn(async ({ target }: { target: WorkspaceRuntimeTarget }) => ({
        id: target.unitId,
        ...(target.unitId === host.unitId
          ? { resources: [externalReferences({ child: { sourceUnitId: "child" } })] }
          : {}),
      }));
      const loader = loaderWith({
        exportUnitData,
        source: sourceWith(host, {
          resolveReferencedRuntimeTarget: async () => target("child", unitType, host.scope),
        }),
      });

      await expect(loader.loadUnit({ scope: host.scope, unitId: host.unitId })).rejects.toMatchObject({
        code: "workspace-screenshot-reference-unit-type-unsupported",
      });
      expect(exportUnitData).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["non-string data", 1, "data is not a string"],
    ["invalid JSON", "{", "data is not valid JSON"],
    ["array root", "[]", "references is not an object"],
    ["null root", "null", "references is not an object"],
    ["primitive root", "1", "references is not an object"],
    ["missing references", "{}", "references is not an object"],
    ["array references", '{"references":[]}', "references is not an object"],
    ["missing source identity", '{"references":{"a":{}}}', "sourceUnitId is missing"],
    ["blank source identity", '{"references":{"a":{"sourceUnitId":"  "}}}', "sourceUnitId is empty"],
  ])("rejects malformed external reference resource: %s", async (_, data, detail) => {
    const host = target("host", "sheet", { kind: "trunk" });
    const resolveReferencedRuntimeTarget = vi.fn();
    const loader = loaderWith({
      exportUnitData: async () => ({
        id: host.unitId,
        resources: [{ data, name: "UNIVER_EXTERNAL_REFERENCE_PLUGIN" }],
      }),
      source: sourceWith(host, { resolveReferencedRuntimeTarget }),
    });

    await expect(loader.loadUnit({ scope: host.scope, unitId: host.unitId })).rejects.toMatchObject({
      code: "workspace-screenshot-reference-resource-invalid",
      message: `Invalid UNIVER_EXTERNAL_REFERENCE_PLUGIN: ${detail}.`,
    });
    expect(resolveReferencedRuntimeTarget).not.toHaveBeenCalled();
  });

  it("loads distinct active Embed children after formula references and ignores soft-deleted children", async () => {
    const host = target("host", "slide", { kind: "worktree", worktreeId: "wt-1" });
    const formula = target("formula", "sheet", host.scope);
    const child = target("child", "doc", { kind: "trunk" });
    const hostData = {
      id: host.unitId,
      resources: [
        externalReferences({ formula: { sourceUnitId: formula.unitId } }),
        embedResource({
          formulaDuplicate: { childUnitId: formula.unitId, lifecycle: "active" },
          child: {
            lifecycle: "active",
            source: { ref: { unit: { selector: " child ", type: "doc" } } },
          },
          childDuplicate: { childUnitId: child.unitId },
          self: { childUnitId: host.unitId },
          deleted: { lifecycle: "soft-deleted" },
        }),
      ],
    };
    const resolveReferencedRuntimeTarget = vi.fn(
      async ({ unitId }: { unitId: string }) => (unitId === formula.unitId ? formula : child),
    );
    const loader = loaderWith({
      exportUnitData: async ({ target }) =>
        target.unitId === host.unitId ? hostData : { id: target.unitId },
      source: sourceWith(host, { resolveReferencedRuntimeTarget }),
    });

    await expect(loader.loadUnit({ scope: host.scope, unitId: host.unitId })).resolves.toMatchObject({
      formulaReferenceUnits: [{ unitType: "sheet", unitData: { id: formula.unitId } }],
      embeddedUnits: [{ unitType: "doc", unitData: { id: child.unitId } }],
    });
    expect(resolveReferencedRuntimeTarget.mock.calls.map(([input]) => input.unitId)).toEqual([
      formula.unitId,
      child.unitId,
    ]);
  });

  it.each([
    [
      "typed ResourceRef followed by direct descriptor",
      {
        typed: { source: { ref: { unit: { selector: "child", type: "doc" } } } },
        direct: { childUnitId: "child" },
      },
    ],
    [
      "direct descriptor followed by typed ResourceRef",
      {
        direct: { childUnitId: "child" },
        typed: { source: { ref: { unit: { selector: "child", type: "doc" } } } },
      },
    ],
  ])("preserves a declared Embed type across %s", async (_, embeds) => {
    const host = target("host", "slide", { kind: "trunk" });
    const resolveReferencedRuntimeTarget = vi.fn(async () => target("child", "sheet", host.scope));
    const exportUnitData = vi.fn(async ({ target }: { target: WorkspaceRuntimeTarget }) =>
      target.unitId === host.unitId
        ? { id: host.unitId, resources: [embedResource(embeds)] }
        : { id: target.unitId },
    );
    const loader = loaderWith({
      exportUnitData,
      source: sourceWith(host, { resolveReferencedRuntimeTarget }),
    });

    await expect(loader.loadUnit({ scope: host.scope, unitId: host.unitId })).rejects.toMatchObject({
      code: "workspace-screenshot-embed-resource-invalid",
    });
    expect(resolveReferencedRuntimeTarget).toHaveBeenCalledOnce();
    expect(exportUnitData).toHaveBeenCalledOnce();
  });

  it("deduplicates matching declared Embed types", async () => {
    const host = target("host", "slide", { kind: "trunk" });
    const child = target("child", "doc", host.scope);
    const resolveReferencedRuntimeTarget = vi.fn(async () => child);
    const exportUnitData = vi.fn(async ({ target }: { target: WorkspaceRuntimeTarget }) =>
      target.unitId === host.unitId
        ? {
            id: host.unitId,
            resources: [
              embedResource({
                first: { source: { ref: { unit: { selector: child.unitId, type: "doc" } } } },
                second: { source: { ref: { unit: { selector: child.unitId, type: "doc" } } } },
              }),
            ],
          }
        : { id: target.unitId },
    );
    const loader = loaderWith({
      exportUnitData,
      source: sourceWith(host, { resolveReferencedRuntimeTarget }),
    });

    await expect(loader.loadUnit({ scope: host.scope, unitId: host.unitId })).resolves.toMatchObject({
      embeddedUnits: [{ unitType: "doc", unitData: { id: child.unitId } }],
    });
    expect(resolveReferencedRuntimeTarget).toHaveBeenCalledOnce();
    expect(exportUnitData).toHaveBeenCalledTimes(2);
  });

  it("rejects conflicting declared Embed types before resolving the child", async () => {
    const host = target("host", "slide", { kind: "trunk" });
    const resolveReferencedRuntimeTarget = vi.fn();
    const loader = loaderWith({
      exportUnitData: async () => ({
        id: host.unitId,
        resources: [
          embedResource({
            doc: { source: { ref: { unit: { selector: "child", type: "doc" } } } },
            sheet: { source: { ref: { unit: { selector: "child", type: "sheet" } } } },
          }),
        ],
      }),
      source: sourceWith(host, { resolveReferencedRuntimeTarget }),
    });

    await expect(loader.loadUnit({ scope: host.scope, unitId: host.unitId })).rejects.toMatchObject({
      code: "workspace-screenshot-embed-resource-invalid",
    });
    expect(resolveReferencedRuntimeTarget).not.toHaveBeenCalled();
  });

  it.each([
    ["non-string data", 1, "data is not a string"],
    ["invalid JSON", "{", "data is not valid JSON"],
    ["array root", "[]", "embeds is not an object"],
    ["null root", "null", "embeds is not an object"],
    ["primitive root", "1", "embeds is not an object"],
    ["missing embeds", "{}", "embeds is not an object"],
    ["array embeds", '{"embeds":[]}', "embeds is not an object"],
    ["invalid descriptor", '{"embeds":{"a":1}}', "descriptor is not an object"],
    [
      "missing active identity",
      '{"embeds":{"a":{"lifecycle":"active"}}}',
      "active child Unit id is missing",
    ],
    ["invalid ResourceRef", '{"embeds":{"a":{"source":{"ref":"bad"}}}}', "source ref is invalid"],
    [
      "non-string declared type",
      '{"embeds":{"a":{"source":{"ref":{"unit":{"selector":"child","type":1}}}}}}',
      "source ref is invalid",
    ],
    [
      "blank declared type",
      '{"embeds":{"a":{"source":{"ref":{"unit":{"selector":"child","type":"  "}}}}}}',
      "source ref is invalid",
    ],
  ])("rejects malformed Embed resource: %s", async (_, data, detail) => {
    const host = target("host", "slide", { kind: "trunk" });
    const resolveReferencedRuntimeTarget = vi.fn();
    const loader = loaderWith({
      exportUnitData: async () => ({
        id: host.unitId,
        resources: [{ data, name: "UNIVER_EMBED_RESOURCE_PLUGIN" }],
      }),
      source: sourceWith(host, { resolveReferencedRuntimeTarget }),
    });

    await expect(loader.loadUnit({ scope: host.scope, unitId: host.unitId })).rejects.toMatchObject({
      code: "workspace-screenshot-embed-resource-invalid",
      message: `Invalid UNIVER_EMBED_RESOURCE_PLUGIN: ${detail}.`,
    });
    expect(resolveReferencedRuntimeTarget).not.toHaveBeenCalled();
  });

  it("rewrites shared Worktree Assets across Host, formula, and Embed copies without mutating sources", async () => {
    const host = target("host", "board", { kind: "worktree", worktreeId: "wt-1" });
    const formula = target("formula", "sheet", host.scope);
    const child = target("child", "slide", host.scope);
    const hostData = {
      id: host.unitId,
      resources: [
        externalReferences({ formula: { sourceUnitId: formula.unitId } }),
        embedResource({ child: { childUnitId: child.unitId } }),
        {
          data: JSON.stringify({ drawing: image("asset-shared") }),
          name: "SHEET_DRAWING_PLUGIN",
        },
      ],
    };
    const formulaData = { id: formula.unitId, drawing: image("asset-shared") };
    const childData = { id: child.unitId, drawing: image("asset-child") };
    const before = structuredClone({ childData, formulaData, hostData });
    const resolveImageAsset = vi.fn(async ({ assetId }: { assetId: string }) => asset(assetId));
    const loader = loaderWith({
      exportUnitData: async ({ target }) =>
        target.unitId === host.unitId
          ? hostData
          : target.unitId === formula.unitId
            ? formulaData
            : childData,
      source: sourceWith(host, {
        resolveImageAsset,
        resolveReferencedRuntimeTarget: async ({ unitId }) =>
          unitId === formula.unitId ? formula : child,
      }),
    });

    const loaded = await loader.loadUnit({ scope: host.scope, unitId: host.unitId });

    expect(resolveImageAsset.mock.calls.map(([input]) => input)).toEqual([
      { assetId: "asset-shared", worktreeId: "wt-1" },
      { assetId: "asset-child", worktreeId: "wt-1" },
    ]);
    expect(loaded.formulaReferenceUnits?.[0]?.unitData).toMatchObject({
      drawing: { imageSourceType: "BASE64", source: "data:image/png;base64,DA==" },
    });
    expect(loaded.embeddedUnits?.[0]?.unitData).toMatchObject({
      drawing: { imageSourceType: "BASE64", source: "data:image/png;base64,Cw==" },
    });
    expect({ childData, formulaData, hostData }).toEqual(before);
  });

  it("does not resolve or rewrite Assets for a Trunk Host", async () => {
    const host = target("host", "sheet", { kind: "trunk" });
    const hostData = { id: host.unitId, drawing: image("asset-1") };
    const resolveImageAsset = vi.fn();
    const loader = loaderWith({
      exportUnitData: async () => hostData,
      source: sourceWith(host, { resolveImageAsset }),
    });

    const loaded = await loader.loadUnit({ scope: host.scope, unitId: host.unitId });

    expect(resolveImageAsset).not.toHaveBeenCalled();
    expect(loaded.unitData).toBe(hostData);
    expect(loaded.unitData).toEqual({ id: "host", drawing: image("asset-1") });
  });
});

function loaderWith(input: {
  readonly exportUnitData: (input: { target: WorkspaceRuntimeTarget }) => Promise<unknown>;
  readonly source: WorkspaceRenderUnitSource;
}): WorkspaceRenderUnitLoader {
  return new WorkspaceRenderUnitLoader({
    runtime: { exportUnitData: input.exportUnitData as never },
    openSource: async () => input.source,
  });
}

function sourceWith(
  host: WorkspaceRuntimeTarget,
  overrides: Partial<WorkspaceRenderUnitSource> = {},
): WorkspaceRenderUnitSource {
  return {
    resolveImageAsset: async () => undefined,
    resolveReferencedRuntimeTarget: async ({ unitId }) => target(unitId, "sheet", host.scope),
    resolveRuntimeTarget: async () => host,
    resolveTrunkRuntimeTarget: async () => host,
    ...overrides,
  };
}

function target(
  unitId: string,
  unitType: WorkspaceRuntimeTarget["unitType"],
  scope: WorkspaceRuntimeTarget["scope"],
): WorkspaceRuntimeTarget {
  return { origin: "https://workspace.test", revision: 1, scope, unitId, unitType };
}

function externalReferences(references: Record<string, unknown>) {
  return {
    data: JSON.stringify({ references }),
    name: "UNIVER_EXTERNAL_REFERENCE_PLUGIN",
  };
}

function embedResource(embeds: Record<string, unknown>) {
  return { data: JSON.stringify({ embeds }), name: "UNIVER_EMBED_RESOURCE_PLUGIN" };
}

function image(source: string) {
  return { imageSourceType: "UUID", source };
}

function asset(assetId: string): ScreenshotImageAsset {
  return {
    bytes: Uint8Array.from([assetId.length]),
    contentLength: 1,
    mediaType: "image/png",
  };
}
