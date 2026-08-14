import { appendFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectSource, openSource, writeDownload } from "../src/files.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (path) => await rm(path, { force: true, recursive: true })),
  );
});

describe("Workspace application file safety", () => {
  it("detects a Blob source that changes after inspection", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "source.bin");
    await writeFile(path, "abc");
    const source = await inspectSource(path);
    await appendFile(path, "d");

    await expect(collect(openSource(source))).rejects.toMatchObject({
      code: "workspace-blob-size-mismatch",
      detail: { actualByteSize: 4, expectedByteSize: 3, path },
    });
  });

  it("writes exact bytes atomically with private permissions", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "download.bin");
    const result = await writeDownload({
      content: chunks("ab", "cd"),
      expectedSize: 4,
      kind: "blob",
      outputPath,
    });

    expect(result).toEqual({ byteSize: 4, outputPath });
    expect(await readFile(outputPath, "utf8")).toBe("abcd");
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
  });

  it("does not clobber an output created during a non-force download", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "race.bin");
    async function* racingContent(): AsyncIterable<Uint8Array> {
      await writeFile(outputPath, "winner");
      yield Buffer.from("loser");
    }

    await expect(
      writeDownload({ content: racingContent(), expectedSize: 5, kind: "asset", outputPath }),
    ).rejects.toMatchObject({ code: "workspace-asset-output-exists" });
    expect(await readFile(outputPath, "utf8")).toBe("winner");
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("removes temporary output when the response is shorter than declared", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "short.bin");
    await expect(
      writeDownload({ content: chunks("abc"), expectedSize: 4, kind: "blob", outputPath }),
    ).rejects.toMatchObject({
      code: "workspace-blob-size-mismatch",
      detail: { actualByteSize: 3, expectedByteSize: 4, path: outputPath },
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it("replaces an existing output only when force is explicit", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "force.bin");
    await writeFile(outputPath, "old");
    await expect(
      writeDownload({ content: chunks("new"), kind: "asset", outputPath }),
    ).rejects.toMatchObject({ code: "workspace-asset-output-exists" });
    await writeDownload({ content: chunks("new"), force: true, kind: "asset", outputPath });
    expect(await readFile(outputPath, "utf8")).toBe("new");
  });
});

async function* chunks(...values: readonly string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield Buffer.from(value);
}

async function collect(content: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const values: Uint8Array[] = [];
  for await (const chunk of content) values.push(chunk);
  return Buffer.concat(values);
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "workspace-files-"));
  temporaryDirectories.push(path);
  return path;
}
