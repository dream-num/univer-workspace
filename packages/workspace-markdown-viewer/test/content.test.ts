// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isMarkdownFile,
  markdownUrl,
  MARKDOWN_PREVIEW_BYTES,
  readMarkdownContent,
} from "../src/content.js";

describe("Markdown classification and bounded reads", () => {
  it("recognizes uploads and historical MIME values without treating known binary formats as text", () => {
    for (const name of ["readme.md", "README.MD", "notes.markdown"]) {
      expect(isMarkdownFile(name, "text/plain; charset=utf-8")).toBe(true);
      expect(isMarkdownFile(name, "application/octet-stream")).toBe(true);
      expect(isMarkdownFile(name, "image/png")).toBe(false);
    }
    expect(isMarkdownFile("notes", "Text/Markdown; charset=utf-8")).toBe(true);
    expect(isMarkdownFile("notes.txt", "text/plain")).toBe(false);
    expect(isMarkdownFile("app.univer.html", "text/html")).toBe(false);
  });

  it("decodes complete UTF-8, BOM and empty files", async () => {
    expect(await readMarkdownContent(new Response("\ufeff# 中文 😀"))).toEqual({
      text: "# 中文 😀",
      truncated: false,
    });
    expect(await readMarkdownContent(new Response(""))).toEqual({ text: "", truncated: false });
    expect(
      (await readMarkdownContent(new Response("x".repeat(MARKDOWN_PREVIEW_BYTES)))).truncated,
    ).toBe(false);
  });

  it("bounds even a server that ignores Range and drops only the incomplete UTF-8 tail", async () => {
    const result = await readMarkdownContent(new Response("中".repeat(MARKDOWN_PREVIEW_BYTES)));
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("中".repeat(Math.floor(MARKDOWN_PREVIEW_BYTES / 3)));
  });

  it("handles partial responses and rejects invalid ranges, invalid UTF-8, binary and HTTP errors", async () => {
    expect(
      await readMarkdownContent(
        new Response("abc", { status: 206, headers: { "Content-Range": "bytes 0-2/10" } }),
      ),
    ).toEqual({ text: "abc", truncated: true });
    for (const response of [
      new Response("no", { status: 403 }),
      new Response("abc", { status: 206 }),
      new Response("abc", { status: 206, headers: { "Content-Range": "bytes 3-5/6" } }),
      new Response(new Uint8Array([0xff])),
      new Response(new Uint8Array([0xe4, 0xb8])),
      new Response("bad\0text"),
    ]) {
      await expect(readMarkdownContent(response)).rejects.toThrow();
    }
  });

  it("cancels oversized streams", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(MARKDOWN_PREVIEW_BYTES + 10).fill(65));
      },
      cancel() {
        cancelled = true;
      },
    });
    expect((await readMarkdownContent(new Response(stream))).truncated).toBe(true);
    expect(cancelled).toBe(true);
  });
});

describe("Markdown URLs", () => {
  it("permits explicit web links, mail links and local fragments", () => {
    for (const url of [
      "https://example.org/a",
      "http://example.org",
      "mailto:hello@example.org",
      "#你好",
    ])
      expect(markdownUrl(url)).toBe(url);
  });
  it("rejects executable, relative, credential-bearing and obfuscated URLs", () => {
    for (const url of [
      "javascript:alert(1)",
      "java\nscript:alert(1)",
      "data:image/svg+xml,bad",
      "file:///tmp/a",
      "//example.org/a",
      "/api/private",
      "../photo.png",
      "https://user:secret@example.org",
    ])
      expect(markdownUrl(url)).toBe("");
    expect(markdownUrl("#local", true)).toBe("");
    expect(markdownUrl("mailto:a@example.org", true)).toBe("");
  });
});
