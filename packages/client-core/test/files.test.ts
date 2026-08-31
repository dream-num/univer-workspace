import { appendFile, mkdtemp, readFile, readdir, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentLength,
  inspectSource,
  openSource,
  responseContent,
  writeDownload,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (path) => await rm(path, { force: true, recursive: true })),
  );
});

describe("Workspace application file safety", () => {
  it("rejects unavailable and non-regular Blob sources", async () => {
    const directory = await temporaryDirectory();
    await expect(inspectSource(join(directory, "missing.bin"))).rejects.toMatchObject({
      code: "workspace-blob-source-unavailable",
    });
    await expect(inspectSource(directory)).rejects.toMatchObject({
      code: "workspace-blob-source-invalid",
    });
  });

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

  it("detects a shortened or unreadable Blob source after inspection", async () => {
    const directory = await temporaryDirectory();
    const shortenedPath = join(directory, "shortened.bin");
    await writeFile(shortenedPath, "abcd");
    const shortened = await inspectSource(shortenedPath);
    await truncate(shortenedPath, 3);
    await expect(collect(openSource(shortened))).rejects.toMatchObject({
      code: "workspace-blob-size-mismatch",
      detail: { actualByteSize: 3, expectedByteSize: 4, path: shortenedPath },
    });

    const removedPath = join(directory, "removed.bin");
    await writeFile(removedPath, "abc");
    const removed = await inspectSource(removedPath);
    await rm(removedPath);
    await expect(collect(openSource(removed))).rejects.toMatchObject({
      code: "workspace-blob-source-unavailable",
      detail: { path: removedPath },
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

  it("preserves an existing force target when streaming fails", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "force-failure.bin");
    await writeFile(outputPath, "old");
    async function* failingContent(): AsyncIterable<Uint8Array> {
      yield Buffer.from("new");
      throw new Error("stream failed");
    }

    await expect(
      writeDownload({ content: failingContent(), force: true, kind: "asset", outputPath }),
    ).rejects.toMatchObject({ code: "workspace-asset-download-write-failed" });
    expect(await readFile(outputPath, "utf8")).toBe("old");
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it.each(["", "-1", "1.5", "NaN", "Infinity", "9007199254740992"])(
    "rejects invalid Content-Length %j",
    (value) => {
      expect(() =>
        contentLength(new Response("body", { headers: { "content-length": value } }), "Asset"),
      ).toThrowError(expect.objectContaining({ code: "workspace-invalid-response" }));
    },
  );

  it("streams response bytes and rejects a missing body", async () => {
    await expect(
      collect(responseContent(new Response("abc"))),
    ).resolves.toEqual(Buffer.from("abc"));
    await expect(collect(responseContent(new Response(null)))).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });
  });

  it("cancels source and response streams without reporting partial success", async () => {
    const directory = await temporaryDirectory();
    const sourcePath = join(directory, "large.bin");
    await writeFile(sourcePath, Buffer.alloc(256 * 1024, 1));
    const source = await inspectSource(sourcePath);
    const sourceController = new AbortController();
    const sourceIterator = openSource(source, sourceController.signal)[Symbol.asyncIterator]();
    await expect(sourceIterator.next()).resolves.toMatchObject({ done: false });
    sourceController.abort(new Error("source cancelled"));
    await expect(sourceIterator.next()).rejects.toThrow("source cancelled");

    let streamCancelled = false;
    const responseController = new AbortController();
    const response = new Response(new ReadableStream<Uint8Array>({
      cancel: () => {
        streamCancelled = true;
      },
      pull: () => new Promise(() => undefined),
    }));
    const responseIterator = responseContent(response, responseController.signal)[Symbol.asyncIterator]();
    const pending = responseIterator.next();
    responseController.abort(new Error("response cancelled"));
    await expect(pending).rejects.toThrow("response cancelled");
    expect(streamCancelled).toBe(true);
  });

  it("removes a private temporary output when cancellation wins before publication", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "cancelled.bin");
    await writeFile(outputPath, "existing");
    const controller = new AbortController();
    async function* cancelledContent(): AsyncIterable<Uint8Array> {
      yield Buffer.from("replacement");
      controller.abort(new Error("download cancelled"));
    }

    await expect(writeDownload({
      content: cancelledContent(),
      force: true,
      kind: "blob",
      outputPath,
      signal: controller.signal,
    })).rejects.toThrow("download cancelled");
    expect(await readFile(outputPath, "utf8")).toBe("existing");
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("cancels an unfinished response stream after a size failure and removes its temp", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "oversize.bin");
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      cancel: () => { cancelled = true; },
      start(controller) { controller.enqueue(Buffer.from("oversize")); },
    }));
    await expect(writeDownload({
      content: responseContent(response),
      expectedSize: 4,
      kind: "blob",
      outputPath,
    })).rejects.toMatchObject({ code: "workspace-blob-size-mismatch" });
    expect(cancelled).toBe(true);
    expect(await readdir(directory)).toEqual([]);
  });

  it("keeps a confirmed atomic publication when cancellation arrives afterward", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "published.bin");
    const controller = new AbortController();
    let contentFinished = false;
    let postContentChecks = 0;
    async function* confirmedContent(): AsyncIterable<Uint8Array> {
      yield Buffer.from("confirmed");
      contentFinished = true;
    }
    const signal = new Proxy(controller.signal, {
      get(target, property) {
        if (property === "throwIfAborted") {
          return () => {
            target.throwIfAborted();
            if (contentFinished && ++postContentChecks === 3) {
              queueMicrotask(() => controller.abort(new Error("late cancellation")));
            }
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await writeDownload({
      content: confirmedContent(),
      expectedSize: 9,
      kind: "asset",
      outputPath,
      signal,
    });

    expect(result).toEqual({ byteSize: 9, outputPath });
    expect(controller.signal.aborted).toBe(true);
    expect(await readFile(outputPath, "utf8")).toBe("confirmed");
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
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
