import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDocTypstBundle } from "@univer-cli/doc-typst-facade";
import { describe, expect, it } from "vitest";
import { HeadlessWorkspaceTypstMaterializer } from "../src/index.js";

describe("Workspace Typst native runtime", () => {
  it("materializes the same real compiled bundle deterministically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workspace-typst-materialize-"));
    try {
      await mkdir(join(directory, "pages"));
      await writeFile(join(directory, "pages", "one.typ"), "= Hello\n\nWorld", "utf8");
      await writeFile(
        join(directory, "typst.json"),
        JSON.stringify({
          pages: ["pages/one.typ"],
          schemaVersion: 1,
          targetUnitId: "materialized-doc",
          title: "Materialized paper",
        }),
        "utf8",
      );

      const output = await compileDocTypstBundle(directory);
      const first = await new HeadlessWorkspaceTypstMaterializer().materialize(output);
      const second = await new HeadlessWorkspaceTypstMaterializer().materialize(output);

      expect(first.initialData).toMatchObject({ id: "materialized-doc", rev: 1 });
      expect(first.initialData).toEqual(second.initialData);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);
});
