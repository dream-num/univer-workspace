// Writes a PNG fixture: node png-fixture.mjs <out> <width> <height> <blocks|noise>
// blocks: four solid colour quadrants. noise: random pixels that PNG cannot compress.
import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const [out, w, h, mode] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4]), process.argv[5]];
const row = (y) => {
  const buf = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) {
    let rgb;
    if (mode === "noise") rgb = [Math.random() * 256, Math.random() * 256, Math.random() * 256];
    else {
      const left = x < w / 2, top = y < h / 2;
      rgb = left && top ? [220, 40, 40] : !left && top ? [40, 160, 60] : left ? [40, 80, 220] : [240, 200, 30];
    }
    buf.set(rgb, 1 + x * 3);
  }
  return buf;
};
const raw = Buffer.concat(Array.from({ length: h }, (_, y) => row(y)));
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(out, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
]));
