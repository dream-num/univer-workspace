// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isMarkdownFile,
  markdownUrl,
  readMarkdownContent,
} from "../src/content.js";

describe("Markdown classification and full reads", () => {
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
    expect(await readMarkdownContent(new Response("\ufeff# 中文 😀"))).toBe("# 中文 😀");
    expect(await readMarkdownContent(new Response(""))).toBe("");
  });

  it("reads files larger than 256 KiB through the final character", async () => {
    const text = "# 大文件\n" + "中文😀".repeat(50000) + "\n## 文件末尾";
    expect(await readMarkdownContent(new Response(text))).toBe(text);
  });

  it("rejects partial responses, invalid UTF-8, binary and HTTP errors", async () => {
    for (const response of [
      new Response("no", { status: 403 }),
      new Response("abc", { status: 206 }),
      new Response("abc", { status: 206, headers: { "Content-Range": "bytes 0-2/10" } }),
      new Response(new Uint8Array([0xff])),
      new Response(new Uint8Array([0xe4, 0xb8])),
      new Response("bad\0text"),
    ]) {
      await expect(readMarkdownContent(response)).rejects.toThrow();
    }
  });

  it("preserves UTF-8 characters split across stream chunks", async () => {
    const bytes = new TextEncoder().encode("中文😀");
    const stream = new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    expect(await readMarkdownContent(new Response(stream))).toBe("中文😀");
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
