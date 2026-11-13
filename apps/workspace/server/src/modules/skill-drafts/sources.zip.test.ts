import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ARCHIVE_LIMITS, extractSkillZip } from "./sources.zip.js";
const data = (text: string) => Buffer.from(text);
const entry = (name: string) => zipSync({ [name]: data("test") }, { level: 0 });
function forged(size: number, compressed = 4) {
  const zip = Buffer.from(entry("x"));
  const central = zip.indexOf(Buffer.from("504b0102", "hex"));
  zip.writeUInt32LE(size, central + 24);
  zip.writeUInt32LE(compressed, central + 20);
  return zip;
}
describe("bounded Skill zip extraction", () => {
  it("preserves text, binary and explicit folders", () => {
    const binary = new Uint8Array([0, 255, 128, 1]);
    const zip = zipSync({
      "skill/": new Uint8Array(),
      "skill/SKILL.md": data("Hello"),
      "skill/assets/x.bin": binary,
    });
    expect(extractSkillZip(zip)).toEqual([
      { path: "skill/SKILL.md", bytes: data("Hello") },
      { path: "skill/assets/x.bin", bytes: Buffer.from(binary) },
    ]);
  });
  it.each(["../bad", "/absolute", "a/../bad", "a\\b", "C:/bad", "./bad", "a//b", "a/\u0000bad"])(
    "rejects unsafe path %s",
    (name) => {
      expect(() => extractSkillZip(entry(name))).toThrow(/unsafe path/);
    },
  );
  it("rejects symlinks before inflating", () => {
    const zip = Buffer.from(entry("link"));
    const central = zip.indexOf(Buffer.from("504b0102", "hex"));
    zip.writeUInt32LE(0xa1ff0000, central + 38);
    expect(() => extractSkillZip(zip)).toThrow(/symlink/);
  });
  it("rejects entry count at the directory header", () => {
    const zip = Buffer.from(entry("x"));
    zip.writeUInt16LE(ARCHIVE_LIMITS.entries + 1, zip.length - 12);
    expect(() => extractSkillZip(zip)).toThrow(/entry/);
  });
  it("rejects per-file size before reading compressed data", () =>
    expect(() => extractSkillZip(forged(ARCHIVE_LIMITS.fileBytes + 1))).toThrow(/per-file/));
  it("rejects total expanded size before inflating", () => {
    const zip = Buffer.from(
      zipSync(
        Object.fromEntries(
          Array.from({ length: 6 }, (_, i) => [`x${i}`, new Uint8Array(256 * 1024)]),
        ),
        { level: 0 },
      ),
    );
    let at = zip.indexOf(Buffer.from("504b0102", "hex"));
    for (let i = 0; i < 6; i++) {
      zip.writeUInt32LE(20 * 1024 * 1024, at + 24);
      zip.writeUInt32LE(20 * 1024 * 1024, zip.readUInt32LE(at + 42) + 22);
      at += 46 + zip.readUInt16LE(at + 28) + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    }
    expect(() => extractSkillZip(zip)).toThrow(/total size/);
  });
  it("rejects compression ratio bombs before inflating", () => {
    const zip = zipSync({ bomb: new Uint8Array(1024 * 1024) });
    expect(() => extractSkillZip(zip)).toThrow(/compression ratio/);
  });
  it("rejects forged local sizes before starting the inflater", () => {
    const zip = Buffer.from(entry("safe"));
    zip.writeUInt32LE(0xffffffff, 22);
    expect(() => extractSkillZip(zip)).toThrow(/Invalid zip/);
  });
  it("rejects corrupt content using the archive CRC", () => {
    const zip = Buffer.from(entry("safe"));
    zip[34] = 0x78;
    expect(() => extractSkillZip(zip)).toThrow(/Invalid zip/);
  });
  it("rejects central/local path disagreement and invalid archives", () => {
    const zip = Buffer.from(entry("safe"));
    zip[30] = 0x78;
    expect(() => extractSkillZip(zip)).toThrow();
    expect(() => extractSkillZip(data("not a zip"))).toThrow();
  });
});
