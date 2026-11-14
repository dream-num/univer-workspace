import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { tools } from "../src/gateway/tools/registry.js";

const toolNames = new Set(tools.map(({ name }) => name));
const fieldNames = new Set(["idempotency_key"]);

function unknownTools(content: string) {
  const mentioned = new Set(
    [...content.matchAll(/`([^`\n]+)`/gu)].flatMap((code) =>
      [...code[1]!.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gu)].map((match) => match[0]),
    ),
  );
  return [...mentioned].filter((name) => !toolNames.has(name) && !fieldNames.has(name));
}

describe("HTML View Creator Skill tool bindings", () => {
  it("names only registered gateway tools", async () => {
    const content = await readFile(new URL("../skills/html-view-creator/SKILL.md", import.meta.url), "utf8");
    expect(unknownTools(content)).toEqual([]);
  });

  it("rejects invented tools in inline code while exempting explicit fields", () => {
    expect(unknownTools('Use `invented_tool` and `another_tool {"name": "page"}`.')).toEqual([
      "invented_tool", "another_tool",
    ]);
    expect(unknownTools('Use `html_view_create` with `idempotency_key`; read `skills_read {"name": "html-view"}`.')).toEqual([]);
  });
});
