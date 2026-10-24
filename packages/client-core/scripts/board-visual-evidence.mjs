import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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
  { overviewOnly = false } = {},
) {
  await mkdir(directory, { recursive: true });
  const first = await screenshot.capture({
    unitType: "board",
    unitData,
    target: { kind: "board-content" },
  });
  assert.equal(first.images.length, 1, "Visual case must have one active Board page");
  const bounds = first.images[0].contentBounds;
  assert.ok(bounds, "No rendered content extent available");
  const captures = [];
  const save = async (name, result, target) => {
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
    }
  };
  const capture = async (name, region, scale) => {
    const target = { kind: "board-content", region, scale };
    await save(name, await screenshot.capture({ unitType: "board", unitData, target }), target);
  };
  const fitScale = first.images[0].scale;
  await save("fit", first, { kind: "board-content" });
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
      extentSource: "public-rendered-capture-bounds",
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
