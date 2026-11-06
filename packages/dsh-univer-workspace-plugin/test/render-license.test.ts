import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { registerRenderTools } from "../src/tools/render.ts";

const runtime = vi.hoisted(() => ({ close: vi.fn(), create: vi.fn(), lint: vi.fn() }));
vi.mock("@univer-cli/univer-render-runtime", () => ({
  createUniverRenderRuntime: runtime.create,
  isUniverRenderError: () => false,
}));
vi.mock("@univer-cli/unit-screenshot", () => ({
  createUnitScreenshot: () => ({
    capture: async () => ({ unitId: "unit", unitType: "slide", images: [] }),
  }),
  isUnitScreenshotError: () => false,
}));
vi.mock("@univer-cli/unit-layout-lint", () => ({
  createUnitLayoutLint: () => ({ lint: runtime.lint }),
  isUnitLayoutLintError: () => false,
}));
import { lintUnitLayout, screenshotUnit } from "../src/provider/render-operations.ts";

afterEach(() => vi.clearAllMocks());

it("checks Board models without browser infrastructure and preserves raw coverage", async () => {
  const source = {
    unitId: "board",
    unitType: "board" as const,
    unitData: { id: "board" } as never,
  };
  const report = {
    unitType: "board",
    findings: [],
    status: "incomplete",
    coverage: { complete: false, incomplete: [{ reason: "unresolved-route" }] },
  };
  runtime.lint.mockResolvedValueOnce(report);

  await expect(
    lintUnitLayout(
      source,
      undefined,
      {
        license: "test-application-license",
        env: {},
      },
      { mode: "model" },
    ),
  ).resolves.toBe(report);

  expect(runtime.create).not.toHaveBeenCalled();
  expect(runtime.lint).toHaveBeenCalledWith({
    unitType: "board",
    unitData: source.unitData,
    mode: "model",
  });
});

it("bootstraps screenshots and layout lint with the application-resolved license", async () => {
  const output = await mkdtemp(join(tmpdir(), "workspace-render-license-"));
  const source = { unitId: "unit", unitType: "slide" as const, unitData: { id: "unit" } as never };
  const config = {
    license: "resolved-application-license",
    env: { UWH_RENDER_PAGE_ROOT: "/render-page" },
  };
  runtime.create.mockResolvedValue({ close: runtime.close });
  try {
    await screenshotUnit(source, output, undefined, config);
    await lintUnitLayout(source, undefined, config);
    expect(runtime.create).toHaveBeenCalledTimes(2);
    for (const [options] of runtime.create.mock.calls) {
      expect(options).toMatchObject({ renderPageRoot: "/render-page", license: config.license });
    }
    expect(runtime.close).toHaveBeenCalledTimes(2);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

it.each([0, 12])(
  "forwards native Board distance %s and keeps incomplete evidence intact",
  async (maximumAutomaticLabelDistance) => {
    const source = {
      unitId: "board",
      unitType: "board" as const,
      unitData: { id: "board" } as never,
    };
    const report = {
      unitType: "board",
      status: "incomplete",
      findings: [],
      coverage: {
        complete: false,
        incomplete: [{ reason: "automatic-label-distance-unavailable" }],
      },
    };
    runtime.create.mockResolvedValue({ close: runtime.close });
    runtime.lint.mockResolvedValueOnce(report);
    await expect(
      lintUnitLayout(
        source,
        undefined,
        { license: "license", env: { UWH_RENDER_PAGE_ROOT: "/render-page" } },
        { mode: "both", maximumAutomaticLabelDistance },
      ),
    ).resolves.toBe(report);
    expect(runtime.lint).toHaveBeenCalledWith({
      unitType: "board",
      unitData: source.unitData,
      mode: "both",
      maximumAutomaticLabelDistance,
    });
    expect(runtime.close).toHaveBeenCalledOnce();
  },
);

it.each([NaN, Infinity, -1])(
  "rejects invalid Board distance %s before opening the runtime",
  async (maximumAutomaticLabelDistance) => {
    await expect(
      lintUnitLayout(
        { unitId: "board", unitType: "board", unitData: { id: "board" } as never },
        undefined,
        { license: "license", env: {} },
        { maximumAutomaticLabelDistance },
      ),
    ).rejects.toThrow(/finite non-negative/);
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.lint).not.toHaveBeenCalled();
  },
);

it.each(["slide", "model"])(
  "rejects distance for %s-only checks before opening the runtime",
  async (kind) => {
    await expect(
      lintUnitLayout(
        {
          unitId: "unit",
          unitType: kind === "slide" ? "slide" : "board",
          unitData: { id: "unit" } as never,
        },
        undefined,
        { license: "license", env: {} },
        {
          ...(kind === "model" ? { mode: "model" as const } : {}),
          maximumAutomaticLabelDistance: 0,
        },
      ),
    ).rejects.toThrow(kind === "slide" ? /only supported for Board/ : /requires rendered or both/);
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.lint).not.toHaveBeenCalled();
  },
);

it("forwards the registered DSH tool's numeric policy and native port planning through the real provider", async () => {
  const definitions: ToolDefinition[] = [];
  const source = { id: "board" };
  const service = {
    resolveSpaceForSession: async () => ({ userId: "user", spaceId: "space" }),
    resolveUnitResource: async () => ({ unitType: "board" }),
    exportUnitData: vi.fn(async () => source),
  };
  const ctx = {
    get: (name: string) => (name === "univerWorkspace" ? service : undefined),
    tools: {
      register: (definition: ToolDefinition) => {
        definitions.push(definition);
        return () => undefined;
      },
    },
  } as unknown as Context;
  const previous = process.env.UWH_RENDER_PAGE_ROOT;
  process.env.UWH_RENDER_PAGE_ROOT = "/render-page";
  const dispose = registerRenderTools(ctx, { license: "license", includeScreenshot: false });
  try {
    const report = {
      unitType: "board",
      status: "incomplete",
      coverage: { complete: false },
      findings: [],
    };
    runtime.create.mockResolvedValue({ close: runtime.close });
    runtime.lint.mockResolvedValueOnce(report);
    const tool = definitions.find((item) => item.name === "univer_lint")!;
    const exec = { agent: { session: { header: { cwd: "/session" } } } } as ToolRunContext;
    expect(
      await tool.execute(
        {
          unitId: "board",
          unitType: "board",
          mode: "rendered",
          maximumAutomaticLabelDistance: 0,
          includePortPlan: true,
        },
        exec,
      ),
    ).toMatchObject({ operation: "lint", result: report });
    expect(runtime.lint).toHaveBeenCalledWith({
      unitType: "board",
      unitData: source,
      mode: "rendered",
      maximumAutomaticLabelDistance: 0,
      includePortPlan: true,
    });
    runtime.create.mockClear();
    runtime.lint.mockClear();
    await expect(
      tool.execute(
        { unitId: "board", unitType: "board", mode: "rendered", maximumAutomaticLabelDistance: -1 },
        exec,
      ),
    ).rejects.toThrow(/finite non-negative/);
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.lint).not.toHaveBeenCalled();
  } finally {
    dispose();
    if (previous === undefined) delete process.env.UWH_RENDER_PAGE_ROOT;
    else process.env.UWH_RENDER_PAGE_ROOT = previous;
  }
});

it.each([1, 1.25, 2])(
  "forwards native text selection and width budget %s with incomplete evidence intact",
  async (textPlanMaximumWidthGrowth) => {
    const source = {
      unitId: "board",
      unitType: "board" as const,
      unitData: { id: "board" } as never,
    };
    const report = {
      unitType: "board",
      status: "incomplete",
      findings: [],
      coverage: { complete: false, incomplete: [{ reason: "text-plan-incomplete" }] },
    };
    runtime.create.mockResolvedValue({ close: runtime.close });
    runtime.lint.mockResolvedValueOnce(report);
    const textPlanElementIds = ["node"];
    await expect(
      lintUnitLayout(
        source,
        undefined,
        { license: "license", env: { UWH_RENDER_PAGE_ROOT: "/render-page" } },
        { mode: "rendered", textPlanElementIds, textPlanMaximumWidthGrowth },
      ),
    ).resolves.toBe(report);
    expect(runtime.lint).toHaveBeenCalledWith({
      unitType: "board",
      unitData: source.unitData,
      mode: "rendered",
      textPlanElementIds,
      textPlanMaximumWidthGrowth,
    });
    expect(runtime.close).toHaveBeenCalledOnce();
    expect(textPlanElementIds).toEqual(["node"]);
  },
);
it.each(["slide", "model"])(
  "rejects native port planning for %s before browser startup",
  async (kind) => {
    await expect(
      lintUnitLayout(
        {
          unitId: "unit",
          unitType: kind === "slide" ? "slide" : "board",
          unitData: { id: "unit" } as never,
        },
        undefined,
        { license: "license", env: {} },
        { ...(kind === "model" ? { mode: "model" as const } : {}), includePortPlan: true },
      ),
    ).rejects.toThrow(kind === "slide" ? /only supported for Board/ : /requires rendered or both/);
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.lint).not.toHaveBeenCalled();
  },
);

it.each([
  { textPlanMaximumWidthGrowth: 1.25 },
  { textPlanElementIds: ["node"], textPlanMaximumWidthGrowth: 0.5 },
  { textPlanElementIds: ["node"], textPlanMaximumWidthGrowth: 2.1 },
  { textPlanElementIds: ["node"], textPlanMaximumWidthGrowth: NaN },
  { textPlanElementIds: ["node", "node"] },
  { textPlanElementIds: [""] },
  { textPlanElementIds: [] },
])("rejects malformed text planning before browser startup %j", async (options) => {
  await expect(
    lintUnitLayout(
      { unitId: "board", unitType: "board", unitData: { id: "board" } as never },
      undefined,
      { license: "license", env: {} },
      options,
    ),
  ).rejects.toThrow(/textPlan/);
  expect(runtime.create).not.toHaveBeenCalled();
  expect(runtime.lint).not.toHaveBeenCalled();
});
it.each(["slide", "model"])(
  "rejects native text planning for %s before browser startup",
  async (kind) => {
    await expect(
      lintUnitLayout(
        {
          unitId: "unit",
          unitType: kind === "slide" ? "slide" : "board",
          unitData: { id: "unit" } as never,
        },
        undefined,
        { license: "license", env: {} },
        { ...(kind === "model" ? { mode: "model" as const } : {}), textPlanElementIds: ["node"] },
      ),
    ).rejects.toThrow(kind === "slide" ? /only supported for Board/ : /requires rendered or both/);
    expect(runtime.create).not.toHaveBeenCalled();
  },
);
