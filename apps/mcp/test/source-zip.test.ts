import { Zip, ZipDeflate, zipSync } from "fflate";
import { expect, it } from "vitest";
import { readSourceZip } from "../src/executor/source-zip.js";

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
