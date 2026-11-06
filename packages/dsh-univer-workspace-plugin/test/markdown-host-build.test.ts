import { build } from "esbuild";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const optionsUrl = new URL("../scripts/node-esm-options.mjs", import.meta.url);
const execFileAsync = promisify(execFile);

describe("Markdown compiler in a packaged Node ESM host", () => {
  it("loads bundled CommonJS dependencies and compiles without a global require", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workspace-markdown-host-"));
    try {
      const { nodeEsmOptions } = await import(optionsUrl.href);
      const output = join(directory, "compiler.mjs");
      await build({
        ...nodeEsmOptions,
        stdin: {
          contents: 'export { compileDocMarkdown } from "@univer-cli/doc-markdown-facade";',
          resolveDir: pluginRoot,
        },
        outfile: output,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node22",
        logLevel: "silent",
      });
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const compiler = await import(${JSON.stringify(pathToFileURL(output).href)});
        const result = await compiler.compileDocMarkdown("# Hello 世界\\n\\nNative **content**.", { targetUnitId: "bundled-markdown" });
        process.stdout.write(JSON.stringify({ targetUnitId: result.targetUnitId, diagnostics: result.diagnostics, createsDocument: result.javascript.includes("createDocument") }));`,
        ],
        {
          encoding: "utf8",
        },
      );
      expect(JSON.parse(stdout)).toEqual({
        targetUnitId: "bundled-markdown",
        diagnostics: [],
        createsDocument: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
