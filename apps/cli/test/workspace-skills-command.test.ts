import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, type OutputConfiguration } from "commander";
import { describe, expect, it } from "vitest";
import { createSkillsCommand } from "../src/features/skills/command.js";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../skill-data");
const expectedNames = [
  "base",
  "board",
  "core",
  "doc",
  "embed",
  "cross-unit-formula",
  "sheet",
  "slide",
] as const;

describe("Workspace CLI skills command", () => {
  it("matches the production list, get, and path JSON contracts", async () => {
    await expect(runSkills(["skills", "list", "--json"])).resolves.toMatchObject({
      success: true,
      data: expectedNames.map((name) => ({ name })),
    });
    await expect(runSkills(["skills", "get", "core", "--json"])).resolves.toMatchObject({
      success: true,
      data: [{ name: "core", content: expect.any(String) }],
    });
    await expect(runSkills(["skills", "path", "core", "--json"])).resolves.toEqual({
      success: true,
      data: { name: "core", path: join(skillRoot, "core") },
    });
    await expect(runSkills(["skills", "path", "--json"])).resolves.toEqual({
      success: true,
      data: { paths: [skillRoot] },
    });
  });
});

async function runSkills(args: readonly string[]): Promise<Record<string, unknown>> {
  let output = "";
  const outputConfiguration: OutputConfiguration = {
    writeOut: (text) => {
      output += text;
    },
  };
  const program = new Command("univer-workspace-cli").configureOutput(outputConfiguration);
  const command = createSkillsCommand(skillRoot);
  configureOutput(command, outputConfiguration);
  program.addCommand(command);
  await program.parseAsync(args, { from: "user" });
  return JSON.parse(output) as Record<string, unknown>;
}

function configureOutput(command: Command, output: OutputConfiguration): void {
  command.configureOutput(output);
  for (const child of command.commands) configureOutput(child, output);
}
