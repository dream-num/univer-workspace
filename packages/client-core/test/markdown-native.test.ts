import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDocMarkdown, parseDocMarkdownSourceMap } from "@univer-cli/doc-markdown-facade";
import { describe, expect, it } from "vitest";
import {
  compileWorkspaceMarkdownFile,
  HeadlessWorkspaceDocumentMaterializer,
} from "../src/index.js";

describe("Workspace native Markdown integration", () => {
  it("materializes native editable content while inheriting Modern typography", async () => {
    const compiled = await compileDocMarkdown("# Hello 世界\n\nNative **rich text** and 😀.", {
      targetUnitId: "markdown-native-test",
    });
    const result = await new HeadlessWorkspaceDocumentMaterializer("Markdown").materialize(
      compiled,
    );
    expect(result.initialData).toMatchObject({ id: "markdown-native-test", rev: 1 });
    const initial = result.initialData as {
      body: { dataStream: string };
      documentStyle: Record<string, unknown>;
    };
    expect(initial.body.dataStream).toContain("Hello 世界");
    expect(initial.body.dataStream).toContain("Native rich text and 😀.");
    const defaults = (
      await new HeadlessWorkspaceDocumentMaterializer("Markdown").materialize({
        javascript: 'univerAPI.createDocument({id:"default-doc"});',
        targetUnitId: "default-doc",
      })
    ).initialData["documentStyle"] as Record<string, unknown>;
    expect(initial.documentStyle["defaultParagraphStyle"]).toEqual(
      defaults["defaultParagraphStyle"],
    );
    expect(
      parseDocMarkdownSourceMap(result.value).every((entry) => entry.paragraphIds.length > 0),
    ).toBe(true);
  }, 30_000);

  it("rejects symlinked chart resources escaping the authorized source root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "uvw-markdown-native-"));
    const outside = await mkdtemp(join(tmpdir(), "uvw-markdown-outside-"));
    try {
      await writeFile(join(outside, "chart.json"), "{}");
      await symlink(join(outside, "chart.json"), join(directory, "chart.json"));
      await writeFile(join(directory, "source.md"), '::chart{src="./chart.json"}');
      await expect(
        compileWorkspaceMarkdownFile(join(directory, "source.md"), {
          targetUnitId: "resource-test",
        }),
      ).rejects.toThrow();
      expect(await readFile(join(outside, "chart.json"), "utf8")).toBe("{}");
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
