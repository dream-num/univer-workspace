import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readText } from "../src/command.js";

const names = "--body or --body-file";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function stdin(chunks: Iterable<Buffer | string> | AsyncIterable<Buffer | string>): void {
  vi.spyOn(process, "stdin", "get").mockReturnValue(Readable.from(chunks) as typeof process.stdin);
}

describe("Markdown text input", () => {
  it("preserves Chinese, emoji and a BOM when UTF-8 characters cross stdin chunks", async () => {
    const body = "\ufeff# 你好😀\nRésumé **正文**\n";
    stdin(Array.from(Buffer.from(body), (byte) => Buffer.from([byte])));

    await expect(readText(undefined, "-", names)).resolves.toBe(body);
  });

  it("accepts stdin that is already decoded into strings", async () => {
    stdin(["# 你好", "\n😀 review\n"]);

    await expect(readText(undefined, "-", names)).resolves.toBe("# 你好\n😀 review\n");
  });

  it("returns an empty body for empty stdin", async () => {
    stdin([]);

    await expect(readText(undefined, "-", names)).resolves.toBe("");
  });

  it("replaces an incomplete UTF-8 character at EOF", async () => {
    stdin([Buffer.from([0xe4]), Buffer.from([0xbd])]);

    await expect(readText(undefined, "-", names)).resolves.toBe("\ufffd");
  });

  it("propagates a stdin error instead of returning a partial body", async () => {
    const error = new Error("stdin failed");
    stdin((async function* () {
      yield Buffer.from("partial");
      throw error;
    })());

    await expect(readText(undefined, "-", names)).rejects.toBe(error);
  });

  it.each([undefined, "", "# 你好😀\n"])("preserves inline input %j", async (body) => {
    await expect(readText(body, undefined, names)).resolves.toBe(body);
  });

  it("reads a UTF-8 file unchanged", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workspace-read-text-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "body.md");
    const body = "\ufeff# 你好😀\n";
    await writeFile(file, body);

    await expect(readText(undefined, file, names)).resolves.toBe(body);
  });

  it("rejects simultaneous inline and file input", async () => {
    await expect(readText("body", "-", names)).rejects.toMatchObject({
      code: "workspace-argument-invalid",
      message: "Use either --body or --body-file, not both.",
    });
  });
});
