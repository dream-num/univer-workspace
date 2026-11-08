import { performance } from "node:perf_hooks";
import { Zip, ZipDeflate, zipSync } from "fflate";
import { expect, it } from "vitest";
import { markdownAssetLimits } from "../src/executor/ops/markdown-compile.js";
import { readSourceZip, sourceZipPathLimits } from "../src/executor/source-zip.js";

const limits = { entries: 3, fileBytes: 100, totalBytes: 150 };
const data = new Uint8Array([0, 255, 128]);
it("reads binary sources and explicit directories without touching disk", () => {
  const files = readSourceZip(zipSync({ "img/": new Uint8Array(), "img/a.png": data }), limits);
  expect([...files.keys()]).toEqual(["img/a.png"]);
  expect(new Uint8Array(files.get("img/a.png")!)).toEqual(data);
});
it.each(["../a", "/a", "a/../b", "a\\b", "a//b", "./a", "a\0b", "../"])(
  "rejects unsafe path %j",
  (path) => {
    expect(() => readSourceZip(zipSync({ [path]: data }), limits)).toThrow();
  },
);
it.each([
  { A: data, a: data },
  { é: data, "e\u0301": data },
  { a: data, "a/b": data },
  { "a/": data, a: data },
  { "a/b": data, a: data },
  { "a/b/": new Uint8Array(), a: data },
  { A: data, "a/b/": new Uint8Array() },
])("rejects colliding paths", (files) => {
  expect(() => readSourceZip(zipSync(files), limits)).toThrow();
});
it("caps all entries, individual declared sizes, and total expanded sizes", () => {
  for (const files of [
    { a: data, b: data, c: data, d: data },
    { a: new Uint8Array(101) },
    { a: new Uint8Array(80), b: new Uint8Array(80) },
  ])
    expect(() => readSourceZip(zipSync(files), limits)).toThrow();
});
it("stops a zip bomb whose local header lies about uncompressed size", () => {
  const bytes = zipSync({ a: new Uint8Array(1_000_000) });
  new DataView(bytes.buffer, bytes.byteOffset).setUint32(22, 1, true);
  expect(() => readSourceZip(bytes, limits)).toThrow(/actual uncompressed size/);
});
it("rejects corrupt and incomplete compressed streams", () => {
  const bytes = zipSync({ a: new Uint8Array(5000) });
  expect(() =>
    readSourceZip(bytes.subarray(0, 32), { ...limits, fileBytes: 10000, totalBytes: 10000 }),
  ).toThrow();
  for (const bytes of [new Uint8Array(), new Uint8Array([1, 2, 3]), new Uint8Array(24)])
    expect(() => readSourceZip(bytes, limits)).toThrow();
  expect(readSourceZip(zipSync({}), limits).size).toBe(0);
});

it("enforces actual per-file and total caps when streaming ZIP headers omit sizes", () => {
  function streamingZip(sizes: number[]): Uint8Array {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, bytes) => {
      if (error) throw error;
      chunks.push(bytes);
    });
    for (const [index, size] of sizes.entries()) {
      const file = new ZipDeflate(`image-${index}.png`);
      zip.add(file);
      file.push(new Uint8Array(size), true);
    }
    zip.end();
    return Buffer.concat(chunks);
  }
  expect(() => readSourceZip(streamingZip([101]), limits)).toThrow(/actual uncompressed size/);
  expect(() => readSourceZip(streamingZip([80, 80]), limits)).toThrow(/actual uncompressed size/);
});

it.each(["a/".repeat(2000) + "image.png", "a/".repeat(32) + "image.png"])(
  "rejects over-depth ZIP names before inflating in under 100 ms",
  (path) => {
    const bytes = zipSync({ [path]: new Uint8Array(1_000_000) });
    const start = performance.now();
    expect(() => readSourceZip(bytes, markdownAssetLimits)).toThrow(/entry name exceeds/);
    expect(performance.now() - start).toBeLessThan(100);
  },
);
it("bounds UTF-8 name bytes including explicit directory markers", () => {
  const path = "é".repeat(sourceZipPathLimits.bytes / 2);
  expect(readSourceZip(zipSync({ [path]: data }), limits).has(path)).toBe(true);
  for (const name of [path + "a", path + "/"])
    expect(() => readSourceZip(zipSync({ [name]: data }), limits)).toThrow(/1024 UTF-8 bytes/);
  const deepest = "a/".repeat(sourceZipPathLimits.segments - 1) + "b";
  expect(readSourceZip(zipSync({ [deepest]: data }), limits).has(deepest)).toBe(true);
});
it("enforces Markdown's 4 MiB file, 8 MiB expanded total and 256 entry caps", () => {
  expect(markdownAssetLimits).toEqual({
    entries: 256,
    fileBytes: 4 * 1024 * 1024,
    totalBytes: 8 * 1024 * 1024,
  });
  const full = new Uint8Array(markdownAssetLimits.fileBytes);
  expect(readSourceZip(zipSync({ a: full, b: full }), markdownAssetLimits).size).toBe(2);
  for (const files of [
    { a: new Uint8Array(full.length + 1) },
    { a: full, b: full, c: data },
    Object.fromEntries(Array.from({ length: 257 }, (_, i) => [String(i), data])),
  ])
    expect(() => readSourceZip(zipSync(files), markdownAssetLimits)).toThrow();
});
