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

  it("bundles the current direct-owner Chart Facade contract", async () => {
    const contracts = [
      {
        name: "board",
        owner: "FBoard.newChart",
        insert: "await board.insertChart(info)",
        read: "board.getCharts()",
        stale: ["board.charts", "FBoardCharts", "setData(values).commit()"],
      },
      {
        name: "doc",
        owner: "FDocument.newChart",
        insert: "await doc.insertChart(info)",
        read: "doc.getCharts()",
        stale: [
          "doc.charts",
          "FDocumentCharts",
          "univerAPI.Enum.DocChartInsertAnchorKind",
          "setData(values).commit()",
        ],
      },
      {
        name: "slide",
        owner: "FSlide.newChart",
        insert: "await slide.insertChart(info)",
        read: "slide.getCharts()",
        stale: ["slide.charts", "FSlideCharts", "setData(values).commit()"],
      },
    ] as const;

    for (const contract of contracts) {
      const result = await runSkills(["skills", "get", contract.name, "--json"]);
      const data = result.data as Array<{ content: string }>;
      const content = data[0]?.content;
      expect(content).toEqual(expect.any(String));
      expect(content).toContain(contract.owner);
      expect(content).toContain(contract.insert);
      expect(content).toContain(contract.read);
      expect(content).toContain("chart.setDataSource(values)");
      expect(content).toContain("await chart.remove()");
      for (const stale of contract.stale) expect(content).not.toContain(stale);
    }
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
