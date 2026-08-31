import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDocTypstBundle } from "@univer-cli/doc-typst-facade";
import { describe, expect, it, vi } from "vitest";
import {
  HeadlessWorkspaceTypstMaterializer,
  WorkspaceCompileTypstFeature,
  type WorkspaceUnit,
} from "../src/index.js";

describe("Workspace Typst native runtime", () => {
  it("materializes equal semantic content and exposes the frozen VM-realm limit boundary", async () => {
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
      const [first, second] = await Promise.all([
        new HeadlessWorkspaceTypstMaterializer().materialize(output),
        new HeadlessWorkspaceTypstMaterializer().materialize(output),
      ]);

      expect(first.initialData).toMatchObject({ id: "materialized-doc", rev: 1 });
      expect(foreignPrototypePaths(first.initialData)).toEqual([
        "$/documentStyle/textStyle:Object:foreign",
      ]);
      const firstIdentities = collectOpaqueIdentities(first.initialData);
      const secondIdentities = collectOpaqueIdentities(second.initialData);
      expect(firstIdentities.length).toBeGreaterThan(0);
      expect(firstIdentities).not.toEqual(secondIdentities);
      expect(excludeOpaqueIdentities(first.initialData)).toEqual(
        excludeOpaqueIdentities(second.initialData),
      );

      const create = vi.fn(async (): Promise<WorkspaceUnit> => unit());
      await expect(new WorkspaceCompileTypstFeature({
        compile: async () => output,
        materializer: new HeadlessWorkspaceTypstMaterializer(),
        units: { create },
      }).execute({
        apply: { spaceId: "space-1", worktreeId: "wt-1" },
        bundlePath: directory,
        maxUnitDataBytes: 52_428_800,
        maxUnitDataDepth: 64,
        maxVisibleResultBytes: 7_864_320,
        maxVisibleResultDepth: 64,
      })).resolves.toMatchObject({ committed: true });
      expect(create).toHaveBeenCalledOnce();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);
});

const OPAQUE_IDENTITY_KEYS = new Set(["listId", "paragraphId", "rangeId", "sectionId"]);

function collectOpaqueIdentities(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectOpaqueIdentities);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    OPAQUE_IDENTITY_KEYS.has(key) && typeof item === "string"
      ? [item]
      : collectOpaqueIdentities(item));
}

function excludeOpaqueIdentities(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(excludeOpaqueIdentities);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !OPAQUE_IDENTITY_KEYS.has(key))
      .map(([key, item]) => [key, excludeOpaqueIdentities(item)]),
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function foreignPrototypePaths(value: unknown): string[] {
  const paths: string[] = [];
  const visiting = new Set<object>();
  const visit = (item: unknown, path: string): void => {
    if (typeof item !== "object" || item === null || visiting.has(item)) return;
    visiting.add(item);
    if (!Array.isArray(item)) {
      const prototype = Object.getPrototypeOf(item) as object | null;
      if (prototype !== null && prototype !== Object.prototype) {
        const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
        const constructorValue = constructor !== undefined && "value" in constructor
          ? constructor.value
          : undefined;
        paths.push(
          `${path}:${typeof constructorValue === "function" ? constructorValue.name : "unknown"}:${constructorValue === Object ? "host" : "foreign"}`,
        );
      }
    }
    for (const key of Reflect.ownKeys(item)) {
      if (key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (descriptor !== undefined && "value" in descriptor) {
        visit(descriptor.value, `${path}/${String(key)}`);
      }
    }
    visiting.delete(item);
  };
  visit(value, "$");
  return paths;
}

function unit(): WorkspaceUnit {
  return {
    activationState: "notApplicable",
    change: "added",
    draftHeadRevision: 1,
    mergeResult: "pending",
    name: "Materialized paper",
    nodeId: "node-1",
    resourceId: "resource-1",
    source: "worktree",
    target: { parentNodeId: null, spaceId: "space-1" },
    type: "doc",
    unitId: "server-unit-1",
    worktreeId: "wt-1",
  };
}
