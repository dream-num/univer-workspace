import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function renderedCaptureBounds(image) {
  const measured = image.layoutAnalysis?.contentBounds;
  const selected = image.contentBounds;
  for (const bounds of [selected, measured])
    assert.ok(
      bounds &&
        [bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite) &&
        bounds.width > 0 &&
        bounds.height > 0,
      "Fresh rendered content extent missing",
    );
  const left = Math.min(selected.left, measured.left),
    top = Math.min(selected.top, measured.top);
  return {
    left,
    top,
    width: Math.max(selected.left + selected.width, measured.left + measured.width) - left,
    height: Math.max(selected.top + selected.height, measured.top + measured.height) - top,
  };
}

function containsRect(outer, inner) {
  return (
    inner.left >= outer.left - 1e-6 &&
    inner.top >= outer.top - 1e-6 &&
    inner.left + inner.width <= outer.left + outer.width + 1e-6 &&
    inner.top + inner.height <= outer.top + outer.height + 1e-6
  );
}

export function visualCaptureRegions(bounds, tileWidth = 1000, tileHeight = 720) {
  assert.ok([bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite));
  assert.ok(bounds.width > 0 && bounds.height > 0);
  assert.ok(tileWidth > 48 && tileHeight > 48, "Tiles must be larger than their overlap");
  const regions = [];
  for (let y = 0; y < bounds.height; y += tileHeight - 48) {
    for (let x = 0; x < bounds.width; x += tileWidth - 48) {
      regions.push({
        left: bounds.left + x,
        top: bounds.top + y,
        width: Math.min(tileWidth, bounds.width - x),
        height: Math.min(tileHeight, bounds.height - y),
      });
    }
  }
  return regions;
}

export async function captureVisualEvidence(
  screenshot,
  unitData,
  directory,
  { overviewOnly = false, renderUnits = {} } = {},
) {
  await mkdir(directory, { recursive: true });
  const first = await screenshot.capture({
    unitType: "board",
    unitData,
    ...renderUnits,
    target: { kind: "board-content" },
  });
  assert.equal(first.images.length, 1, "Visual case must have one active Board page");
  const captures = [];
  const save = async (name, result, target) => {
    assert.equal(result.images.length, 1, "Visual case must have one active Board page");
    for (const [index, image] of result.images.entries()) {
      assert.equal(image.layoutAnalysis?.source, "rendered", "Rendered analysis missing");
      const { bytes, ...metadata } = image;
      const file = resolve(directory, `${name}${index ? `-${index}` : ""}.png`);
      await writeFile(file, bytes, { flag: "wx" });
      captures.push({ file, target, ...metadata });
      await writeFile(
        resolve(directory, "capture-progress.json"),
        `${JSON.stringify({ complete: false, outputs: captures }, null, 2)}\n`,
      );
      assert.ok(Number.isFinite(image.scale) && image.scale > 0, "Actual rendered scale missing");
      if (target.scale !== undefined) {
        assert.ok(
          Math.abs(image.scale - target.scale) < 1e-8,
          `Rendered scale ${image.scale} differs from requested ${target.scale}`,
        );
      }
    }
  };
  const capture = async (name, region, scale) => {
    const target = { kind: "board-content", region, scale };
    await save(
      name,
      await screenshot.capture({ unitType: "board", unitData, ...renderUnits, target }),
      target,
    );
  };
  const image = first.images[0];
  let bounds;
  try {
    bounds = renderedCaptureBounds(image);
  } catch (error) {
    await save("initial-model-fit", first, { kind: "board-content" });
    throw error;
  }
  let fitScale = image.scale;
  if (!containsRect(image.contentBounds, bounds)) {
    await save("initial-model-fit", first, { kind: "board-content" });
    // The public renderer fixes Board deviceScaleFactor at 1. Leave 2px for raster rounding beyond the 32px margins.
    fitScale = Math.min(
      image.scale,
      (image.width - 66) / bounds.width,
      (image.height - 66) / bounds.height,
    );
    assert.ok(Number.isFinite(fitScale) && fitScale > 0, "Rendered extent cannot fit the viewport");
    const padding = 32 / fitScale;
    const region = {
      left: bounds.left - padding,
      top: bounds.top - padding,
      width: bounds.width + 2 * padding,
      height: bounds.height + 2 * padding,
    };
    const target = { kind: "board-content", region, scale: fitScale };
    const fit = await screenshot.capture({ unitType: "board", unitData, ...renderUnits, target });
    await save("fit", fit, target);
    assert.ok(
      containsRect(region, renderedCaptureBounds(fit.images[0])),
      "Fresh rendered content escaped the selected Fit extent",
    );
  } else {
    await save("fit", first, { kind: "board-content" });
  }
  if (!overviewOnly) {
    // Explicit-scale captures must fit the renderer viewport; use its successful fit image as a conservative budget.
    for (const scale of [0.5, 1, 2]) {
      const tileWidth = Math.max(50, Math.floor((first.images[0].width - 128) / scale));
      const tileHeight = Math.max(50, Math.floor((first.images[0].height - 128) / scale));
      for (const [index, region] of visualCaptureRegions(bounds, tileWidth, tileHeight).entries()) {
        await capture(
          `tile-${String(index + 1).padStart(3, "0")}-${scale * 100}-percent`,
          region,
          scale,
        );
      }
    }
  }
  const analyses = captures.map((capture) => capture.layoutAnalysis);
  const incomplete = analyses.some(
    (analysis) =>
      analysis.routes.some((route) => !route.resolved) ||
      analysis.issues.some((issue) => /unresolved/.test(issue.rule)),
  );
  const result = {
    status: incomplete
      ? "incomplete"
      : analyses.some((analysis) => analysis.issues.length > 0)
        ? "findings"
        : "clean",
    outputs: captures,
    contentBounds: bounds,
    fitScale,
    coverage: {
      fullContentExtent: true,
      fullNativeScaleTiling: !overviewOnly,
      scales: overviewOnly ? [fitScale] : [fitScale, 0.5, 1, 2],
      visualApproval: "pending",
      extentSource: "fresh-public-rendered-analysis-union",
      typographyInkMeasured: false,
    },
  };
  await writeFile(
    resolve(directory, "capture-progress.json"),
    `${JSON.stringify({ complete: true, outputs: captures }, null, 2)}\n`,
  );
  await writeFile(resolve(directory, "capture.json"), `${JSON.stringify(result, null, 2)}\n`, {
    flag: "wx",
  });
  return result;
}
