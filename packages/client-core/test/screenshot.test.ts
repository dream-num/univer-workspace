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

  it("awaits close before rejecting on capture failure", async () => {
    const failure = new Error("capture failed");
    capture.mockRejectedValueOnce(failure);
    let resolveClose!: () => void;
    const close = vi.fn(async () => await new Promise<void>((resolve) => (resolveClose = resolve)));
    const createRuntime = vi.fn(async () => ({ close }) as unknown as UniverRenderRuntime);
    const feature = featureWith({ createRuntime });
    let settled = false;
    const signal = new AbortController().signal;

    const operation = feature
      .capture({ signal, unitData: { id: "book-1" }, unitType: "sheet" } as UnitScreenshotInput)
      .finally(() => (settled = true));
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    resolveClose();

    await expect(operation).rejects.toBe(failure);
  });

  it("does not create a browser for a pre-aborted signal", async () => {
    const createRuntime = vi.fn();
    const feature = featureWith({ createRuntime });
    const reason = new Error("cancel-before-browser");
    const controller = new AbortController();
    controller.abort(reason);

    await expect(
      feature.capture({
        signal: controller.signal,
        unitData: { id: "book-1" },
        unitType: "sheet",
      } as UnitScreenshotInput),
    ).rejects.toBe(reason);
    expect(createRuntime).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("closes a browser returned after cancellation and starts no capture", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel-during-browser-construction");
    const close = vi.fn(async () => {
      throw new Error("close-secret");
    });
    const feature = featureWith({
      createRuntime: async () => {
        controller.abort(reason);
        return { close } as unknown as UniverRenderRuntime;
      },
    });

    await expect(
      feature.capture({
        signal: controller.signal,
        unitData: { id: "book-1" },
        unitType: "sheet",
      } as UnitScreenshotInput),
    ).rejects.toBe(reason);
    expect(capture).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("prefers an abort that races browser construction rejection", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel-during-browser-construction");
    const feature = featureWith({
      createRuntime: async () => {
        controller.abort(reason);
        throw new Error("browser-dependency-secret");
      },
    });

    await expect(
      feature.capture({
        signal: controller.signal,
        unitData: { id: "book-1" },
        unitType: "sheet",
      } as UnitScreenshotInput),
    ).rejects.toBe(reason);
    expect(capture).not.toHaveBeenCalled();
  });

  it("preserves an abort that races capture rejection and close rejection", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel-during-capture-rejection");
    capture.mockImplementationOnce(async () => {
      controller.abort(reason);
      throw new Error("capture-dependency-secret");
    });
    const close = vi.fn(async () => {
      throw new Error("close-secret");
    });
    const feature = featureWith({
      createRuntime: async () => ({ close }) as unknown as UniverRenderRuntime,
    });

    await expect(
      feature.capture({
        signal: controller.signal,
        unitData: { id: "book-1" },
        unitType: "sheet",
      } as UnitScreenshotInput),
    ).rejects.toBe(reason);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([new Error("capture-primary"), undefined, null])(
    "preserves capture failure %# when close also rejects",
    async (failure) => {
      capture.mockRejectedValueOnce(failure);
      const close = vi.fn(async () => {
        throw new Error("close-secret");
      });
      const feature = featureWith({
        createRuntime: async () => ({ close }) as unknown as UniverRenderRuntime,
      });

      await expect(
        feature.capture({ unitData: { id: "book-1" }, unitType: "sheet" } as UnitScreenshotInput),
      ).rejects.toBe(failure);
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it("observes cancellation that becomes visible while close settles", async () => {
    capture.mockResolvedValueOnce(screenshotResult());
    const controller = new AbortController();
    const reason = new Error("cancel-during-close");
    const close = vi.fn(async () => controller.abort(reason));
    const feature = featureWith({
      createRuntime: async () => ({ close }) as unknown as UniverRenderRuntime,
    });

    await expect(
      feature.capture({
        signal: controller.signal,
        unitData: { id: "book-1" },
        unitType: "sheet",
      } as UnitScreenshotInput),
    ).rejects.toBe(reason);
    expect(close).toHaveBeenCalledOnce();
  });

  it("awaits browser close when cancellation becomes visible during capture", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel-during-capture");
    capture.mockImplementationOnce(async () => {
      controller.abort(reason);
      return screenshotResult();
    });
    let resolveClose!: () => void;
    const close = vi.fn(async () => await new Promise<void>((resolve) => (resolveClose = resolve)));
    const feature = featureWith({
      createRuntime: async () => ({ close }) as unknown as UniverRenderRuntime,
    });
    let settled = false;

    const operation = feature.capture({
      signal: controller.signal,
      unitData: { id: "book-1" },
      unitType: "sheet",
    } as UnitScreenshotInput).finally(() => (settled = true));
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    resolveClose();

    await expect(operation).rejects.toBe(reason);
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
