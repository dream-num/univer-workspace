import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { describe, expect, it } from "vitest";
import { compileSvg } from "../src/provider/svg-operations.ts";
import { lintUnitLayout, screenshotUnit } from "../src/provider/render-operations.ts";
import { registerRenderTools } from "../src/tools/render.ts";

function toolContext() {
  const definitions: ToolDefinition[] = [];
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        definitions.push(definition);
        return () => undefined;
      },
    },
  } as unknown as Context;
  return { ctx, definitions };
}

describe("render tool surface", () => {
  it("registers all three Office-compatible render names", () => {
    const { ctx, definitions } = toolContext();
    const dispose = registerRenderTools(ctx, { license: "test-license" });
    expect(definitions.map((definition) => definition.name)).toEqual([
      "univer_lint",
      "univer_screenshot",
      "univer_compile_svg",
    ]);
    expect(
      definitions.find((definition) => definition.name === "univer_lint")?.parameters,
    ).toMatchObject({
      properties: {
        unitId: { type: "string" },
        unitType: { type: "string", enum: ["slide", "board"] },
        mode: { enum: ["model", "rendered", "both"] },
        includeLabelPlan: { type: "boolean" },
      },
    });
    dispose();
  });

  it("uses the published SVG Facade compiler and returns executable Slide code", async () => {
    const directory = await mkdtemp(join(tmpdir(), "uwh-svg-tool-"));
    try {
      const source = join(directory, "page.svg");
      await writeFile(source, '<svg viewBox="0 0 320 180"><rect width="40" height="20" /></svg>');
      const result = await compileSvg({ source, sourceWorkspace: directory, page: 1 });
      expect(result.textMeasure).toBe("builtin-estimate");
      expect(result.code).toContain("presentation.setPageSize({ width: 320, height: 180 });");
      expect(result.code).toContain("slide.insertShape(");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports missing render infrastructure instead of returning a fake lint/screenshot pass", async () => {
    const source = {
      unitId: "slide-1",
      unitType: "slide" as const,
      unitData: { id: "slide-1" } as never,
    };
    await expect(
      lintUnitLayout(source, undefined, { license: "test-license", env: {} }),
    ).rejects.toThrow(/UWH_RENDER_PAGE_ROOT/);
    await expect(
      screenshotUnit(source, "/tmp/uwh-render-test", undefined, {
        license: "test-license",
        env: {},
      }),
    ).rejects.toThrow(/UWH_RENDER_PAGE_ROOT/);
  });

  it("rejects unsupported Unit types and Slide-only mode misuse before opening a browser", async () => {
    const config = { license: "test-license", env: {} };
    await expect(
      lintUnitLayout(
        {
          unitId: "sheet-1",
          unitType: "sheet",
          unitData: { id: "sheet-1" } as never,
        },
        undefined,
        config,
      ),
    ).rejects.toThrow(/Slide or Board/);
    await expect(
      lintUnitLayout(
        {
          unitId: "slide-1",
          unitType: "slide",
          unitData: { id: "slide-1" } as never,
        },
        undefined,
        config,
        { mode: "model" },
      ),
    ).rejects.toThrow(/only supported for Board/);
    await expect(
      lintUnitLayout(
        { unitId: "board-1", unitType: "board", unitData: { id: "board-1" } as never },
        undefined,
        config,
        { mode: "model", includeLabelPlan: true },
      ),
    ).rejects.toThrow(/requires rendered or both/);
  });
});
