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

  it("bundles the current Facade lookup and cross-Unit Chart workflow", async () => {
    const core = firstContent(await runSkills(["skills", "get", "core", "--json"]));
    const doc = firstContent(await runSkills(["skills", "get", "doc", "--json"]));
    const slide = firstContent(await runSkills(["skills", "get", "slide", "--json"]));
    const embed = firstContent(await runSkills(["skills", "get", "embed", "--json"]));

    expect(core).toContain("queries are not combined as AND");
    expect(core).toContain("`show` accepts one or more exact symbols");
    expect(core).toContain("Do not pass `--unit` to `show`");
    expect(core).toContain("Chart backed by another Unit's Sheet or Base data");
    expect(core).toContain("univer-workspace-cli print-pdf");
    expect(core).toContain("Base → `base`");
    expect(core).not.toContain("without a `base` alias");
    expect(doc).toContain("api find <query...>");
    expect(doc).toContain("api show <symbol...>");
    expect(slide).toContain("api find <query...>");
    expect(slide).toContain("api show <symbol...>");
    expect(embed).toContain("Referencing another Unit's data from a Chart");
    expect(embed).toContain("IResourceRefChartDataSourceInput");
    expect(embed).toContain("newChart(...).setSource(ref)");
    expect(embed).toContain("await chart.setDataSource(ref)");
    expect(embed).toContain("RESOURCE_REF_INVALID_UNIT");
    expect(embed).toContain("dataSource.source.kind");
    expect(embed).toContain("Viewer and execute runtimes");
    expect(embed).toContain("screenshot renderer does not currently preload");
    expect(embed).toContain("only by a Chart");
    expect(embed).not.toContain("A headless execute or screenshot may show a placeholder");
  });

  it("bundles Base and Board structured inspection guidance", async () => {
    const baseResult = await runSkills(["skills", "get", "base", "--full", "--json"]);
    const baseData = baseResult.data as Array<{
      content: string;
      files?: Array<{ content: string; path: string }>;
    }>;
    const base = baseData[0]?.content;
    const board = firstContent(await runSkills(["skills", "get", "board", "--json"]));

    expect(base).toContain("univer-workspace-cli inspect base");
    expect(base).toContain("A new Base already contains");
    expect(base).toContain("BaseFieldType.Currency");
    expect(base).toContain("ICardLayoutConfig");
    expect(base).toContain("explicitly `return` record values");
    expect(base).toContain("injects the selected");
    expect(base).toContain("`FBase` as `base`");
    expect(base).not.toContain("const base = api.getBase");
    expect(base).not.toContain("does not inject a `base` variable");
    expect(base).not.toContain("`inspect base` is not supported");
    expect(baseData[0]?.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "references/formulas.md",
          content: expect.stringContaining("Base Formula fields use Excel structured references"),
        }),
      ]),
    );

    expect(board).toContain("univer-workspace-cli inspect board");
    expect(board).toContain("inspect board-element id:<element-id>");
    expect(board).not.toContain("Native `inspect` is not supported");
  });

  it("bundles inspection commands accepted by the current parser", async () => {
    const core = firstContent(await runSkills(["skills", "get", "core", "--json"]));
    const sheet = firstContent(await runSkills(["skills", "get", "sheet", "--json"]));
    const slide = firstContent(await runSkills(["skills", "get", "slide", "--json"]));

    expect(core).toContain("--worksheet name:<sheet-name>");
    expect(sheet).toContain("inspect range A1:C9 --worksheet name:<sheet-name>");
    expect(sheet).toContain("requires one explicit worksheet selector");
    expect(slide).toContain("inspect slide index:N");
    expect(slide).toContain("inspect slide id:<id>");
    expect(slide).toContain("Use `inspect presentation` without a selector");
    expect(slide).not.toContain("inspect presentation --pages");
    expect(slide).not.toContain("`inspect --pages`");
  });
});

function firstContent(result: Record<string, unknown>): string {
  const data = result.data as Array<{ content: string }>;
  const content = data[0]?.content;
  expect(content).toEqual(expect.any(String));
  return content!;
}

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
