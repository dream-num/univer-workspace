import type { UnitScreenshotInput, UnitScreenshotResult } from "@univer-cli/unit-screenshot";
import type { UniverRenderRuntime } from "@univer-cli/univer-render-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => vi.fn());

vi.mock("@univer-cli/unit-screenshot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@univer-cli/unit-screenshot")>()),
  createUnitScreenshot: () => ({ capture }),
}));

import { WorkspaceScreenshotFeature } from "../src/screenshot.js";

beforeEach(() => capture.mockReset());

describe("Workspace screenshot capture", () => {
  it("passes exact runtime and capture inputs and awaits close before resolving", async () => {
    const result = screenshotResult();
    capture.mockResolvedValueOnce(result);
    let resolveClose!: () => void;
    const close = vi.fn(async () => await new Promise<void>((resolve) => (resolveClose = resolve)));
    const runtime = { close } as unknown as UniverRenderRuntime;
    const createRuntime = vi.fn(async () => runtime);
    const env = { PUPPETEER_CACHE_DIR: "/browser-cache" };
    const signal = new AbortController().signal;
    const feature = featureWith({ createRuntime, env });
    const input = { signal, unitData: { id: "book-1" }, unitType: "sheet" } as UnitScreenshotInput;
    let settled = false;

    const operation = feature.capture(input).finally(() => (settled = true));
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    resolveClose();

    await expect(operation).resolves.toBe(result);
    expect(createRuntime).toHaveBeenCalledWith({
      env,
      license: "license-value",
      renderPageRoot: "/render-runtime",
      signal,
    });
    expect(capture).toHaveBeenCalledWith(input);
  });

  it.each([
    ["ordinary failure", new Error("capture failed")],
    ["abort", Object.assign(new Error("aborted"), { name: "AbortError" })],
  ])("awaits close before rejecting on %s", async (_, failure) => {
    capture.mockRejectedValueOnce(failure);
    let resolveClose!: () => void;
    const close = vi.fn(async () => await new Promise<void>((resolve) => (resolveClose = resolve)));
    const createRuntime = vi.fn(async () => ({ close }) as unknown as UniverRenderRuntime);
    const feature = featureWith({ createRuntime });
    let settled = false;
    const signal = AbortSignal.abort();

    const operation = feature
      .capture({ signal, unitData: { id: "book-1" }, unitType: "sheet" } as UnitScreenshotInput)
      .finally(() => (settled = true));
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    resolveClose();

    await expect(operation).rejects.toBe(failure);
  });

  it("does not fabricate close when runtime creation fails", async () => {
    const failure = new Error("browser failed");
    const createRuntime = vi.fn(async () => {
      throw failure;
    });
    const feature = featureWith({ createRuntime });

    await expect(
      feature.capture({ unitData: { id: "book-1" }, unitType: "sheet" } as UnitScreenshotInput),
    ).rejects.toBe(failure);
    expect(capture).not.toHaveBeenCalled();
  });
});

function featureWith(
  overrides: Partial<ConstructorParameters<typeof WorkspaceScreenshotFeature>[0]> = {},
) {
  return new WorkspaceScreenshotFeature({
    env: {},
    license: "license-value",
    loader: { loadUnit: vi.fn() },
    renderPageRoot: "/render-runtime",
    ...overrides,
  });
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
