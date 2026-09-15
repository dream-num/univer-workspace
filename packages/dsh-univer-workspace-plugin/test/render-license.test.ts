import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ close: vi.fn(), create: vi.fn() }));
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
  createUnitLayoutLint: () => ({ lint: async () => ({ issues: [] }) }),
  isUnitLayoutLintError: () => false,
}));
import { lintUnitLayout, screenshotUnit } from "../src/provider/render-operations.ts";

afterEach(() => vi.clearAllMocks());

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
