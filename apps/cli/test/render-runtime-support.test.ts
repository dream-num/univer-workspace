import { afterEach, describe, expect, it, vi } from "vitest";
import { compositeDomCanvasOverlays } from "../render-runtime/src/support.js";

describe("compositeDomCanvasOverlays", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a Slide Embed canvas from client coordinates into page output pixels", () => {
    const main = canvas(800, 450, rect(100, 40, 800, 450));
    const embed = canvas(800, 400, rect(300, 140, 400, 200));
    stubDocument([embed]);

    const drawImage = vi.fn();
    compositeDomCanvasOverlays(
      { drawImage },
      { width: 1600, height: 900 },
      main,
      { width: 800, height: 450 },
      { left: 0, top: 0, width: 800, height: 450 },
      "[data-embed-slides-floating-object-host] canvas",
    );

    expect(drawImage).toHaveBeenCalledWith(embed, 0, 0, 800, 400, 400, 200, 800, 400);
  });

  it("clips a Slide Embed canvas at the captured page boundary", () => {
    const main = canvas(800, 450, rect(0, 0, 800, 450));
    const embed = canvas(400, 200, rect(50, 25, 200, 100));
    stubDocument([embed]);

    const drawImage = vi.fn();
    compositeDomCanvasOverlays(
      { drawImage },
      { width: 800, height: 450 },
      main,
      { width: 800, height: 450 },
      { left: 100, top: 50, width: 400, height: 225 },
      "[data-embed-slides-floating-object-host] canvas",
    );

    expect(drawImage).toHaveBeenCalledWith(embed, 100, 50, 300, 150, 0, 0, 300, 150);
  });
});

function canvas(width: number, height: number, bounds: DOMRect): HTMLCanvasElement {
  return { width, height, getBoundingClientRect: () => bounds } as HTMLCanvasElement;
}

function stubDocument(canvases: readonly HTMLCanvasElement[]): void {
  vi.stubGlobal("document", {
    querySelectorAll: () => canvases,
  });
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}
