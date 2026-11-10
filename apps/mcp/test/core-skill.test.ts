import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "../src/gateway/tools/registry.js";

const names = new Set(tools.map(({ name }) => name));

function unknownTools(content: string) {
  const mentioned = new Set(
    [...content.matchAll(/`([a-z][a-z0-9]*_[a-z0-9_]+)`/gu)].map((match) => match[1]!),
  );
  for (const row of content.split("\n")) {
    if (!row.startsWith("|")) continue;
    const target = row.split("|")[2];
    for (const match of target?.matchAll(/`([a-z][a-z0-9_]*)`/gu) ?? []) {
      mentioned.add(match[1]!);
    }
  }
  return [...mentioned].filter((name) => !names.has(name));
}

describe("MCP core Skill tool bindings", () => {
  it("names only registered tools, including single-word table bindings", async () => {
    const root = new URL("../skills/", import.meta.url).pathname;
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      const content = await readFile(path, "utf8");
      expect(unknownTools(content), path).toEqual([]);
      expect(content, path).not.toMatch(/\buvw\b/u);
    }
  });

  it("serves no CLI invocation in any assembled Skill file", async () => {
    const root = new URL("../dist/skill-data/", import.meta.url).pathname;
    const files = await readdir(root, { recursive: true, withFileTypes: true });
    expect(files.filter((entry) => entry.isFile()).length).toBeGreaterThan(10);
    for (const entry of files) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      expect(await readFile(path, "utf8"), path).not.toMatch(/\buvw\b/u);
    }
  });

  it("describes every tool without naming the CLI", () => {
    expect(
      tools.filter(({ description }) => /\buvw\b/u.test(description)).map(({ name }) => name),
    ).toEqual([]);
  });

  it("rejects invented snake_case tools and single-word operation bindings", () => {
    expect(unknownTools("Use `invented_tool`.\n| `inspect` | `invented` | Read content |")).toEqual(
      ["invented_tool", "invented"],
    );
    expect(unknownTools("Use `api_show`.\n| `inspect` | `inspect` | Read content |")).toEqual([]);
  });
});
