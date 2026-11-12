import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runProcess } from "./verification-process.mjs";
import { writeVerificationReport } from "./verification-report.mjs";

const step = (id, ...args) => ({ id, argv: ["pnpm", ...args] });
export const stages = {
  static: [
    step("http-contract", "--filter", "@univerjs/univer-workspace", "api:verify"),
    step("typecheck", "typecheck"),
  ],
  "test-workspace": [step("workspace-tests", "--filter", "@univerjs/univer-workspace", "test")],
  "test-cli": [step("cli-tests", "--filter", "univer-workspace-cli", "test")],
  "test-mcp": [
    step("mcp-tests", "--filter", "@univerjs/univer-workspace-mcp", "test", "--maxWorkers=2"),
  ],
  "test-rest": [
    step("verification-tools", "test:ci"),
    step("sdk-dependencies", "test:sdk-dependencies"),
    step("univer-license", "test:univer-license"),
    step("release-policy", "test:release"),
    step("docker-inputs", "test:docker-inputs"),
    {
      ...step(
        "remaining-packages",
        "-r",
        "--no-sort",
        "--workspace-concurrency=2",
        "--filter",
        "!@univerjs/univer-workspace",
        "--filter",
        "!univer-workspace-cli",
        "--filter",
        "!@univerjs/univer-workspace-mcp",
        "test",
      ),
      env: { VITEST_MAX_WORKERS: "2" },
    },
  ],
  package: [
    step("build", "build"),
    step("cli-package", "package:workspace-cli"),
    step("cli-package-smoke", "--filter", "univer-workspace-cli", "package:smoke"),
    step("production-import", "--filter", "@univerjs/univer-workspace", "test:production-import"),
  ],
};
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2));
export async function verify({
  selectedStages = Object.keys(stages),
  install = false,
  cwd = root,
  outputRoot = join(cwd, ".verification"),
  registry = stages,
} = {}) {
  for (const name of selectedStages)
    if (!registry[name]) throw new Error(`Unknown verification stage: ${name}`);
  const attempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1);
  const runId = `${process.env.GITHUB_RUN_ID || new Date().toISOString().replace(/[:.]/g, "-")}-${attempt}-${randomUUID()}`;
  const directory = join(outputRoot, runId);
  await mkdir(outputRoot, { recursive: true });
  await mkdir(directory);
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const run = {
    schemaVersion: 1,
    runId,
    cwd,
    commit: git("rev-parse", "HEAD"),
    headCommit: process.env.UVW_VERIFY_HEAD_SHA || git("rev-parse", "HEAD"),
    dirty: Boolean(git("status", "--porcelain")),
    githubRunId: process.env.GITHUB_RUN_ID || null,
    attempt,
    selectedStages,
    nodeVersion: process.version,
    pnpmVersion: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
    startedAt: new Date().toISOString(),
    status: "running",
  };
  await save(join(directory, "run.json"), run);
  console.log(`Verification reports: ${directory}`);
  let failed = false;
  let needsInstall = install;
  for (const name of selectedStages) {
    const stageDirectory = join(directory, `attempt-${attempt}`, name);
    await mkdir(stageDirectory, { recursive: true });
    const stage = { id: name, status: "running", startedAt: new Date().toISOString(), steps: [] };
    const stageFile = join(stageDirectory, "stage.json");
    await save(stageFile, stage);
    const commands = needsInstall
      ? [step("frozen-install", "install", "--frozen-lockfile"), ...registry[name]]
      : registry[name];
    needsInstall = false;
    for (const [index, command] of commands.entries()) {
      const stepDirectory = join(
        stageDirectory,
        `${String(index + 1).padStart(2, "0")}-${command.id}`,
      );
      await mkdir(stepDirectory);
      stage.steps.push(relative(directory, stepDirectory));
      await save(stageFile, stage);
      const record = {
        ...command,
        cwd,
        startedAt: new Date().toISOString(),
        status: "running",
        exitCode: null,
        signal: null,
        spawnError: null,
        stdoutPath: relative(directory, join(stepDirectory, "stdout.log")),
        stderrPath: relative(directory, join(stepDirectory, "stderr.log")),
      };
      await save(join(stepDirectory, "step.json"), record);
      console.log(
        process.env.GITHUB_ACTIONS ? `::group::${name}/${command.id}` : `\n${name}/${command.id}`,
      );
      const result = await runProcess(command.argv, {
        cwd,
        directory: stepDirectory,
        processGroup: true,
        env: {
          ...process.env,
          ...command.env,
          UVW_VERIFY_REPORT_DIR: join(stepDirectory, "tests"),
        },
      });
      Object.assign(record, result, { finishedAt: new Date().toISOString() });
      await save(join(stepDirectory, "step.json"), record);
      if (process.env.GITHUB_ACTIONS) console.log("::endgroup::");
      if (result.status !== "passed") {
        stage.status = "failed";
        break;
      }
    }
    stage.status = stage.status === "failed" ? "failed" : "passed";
    stage.finishedAt = new Date().toISOString();
    await save(stageFile, stage);
    if (stage.status === "failed") {
      failed = true;
      break;
    }
  }
  run.status = failed ? "failed" : "passed";
  run.finishedAt = new Date().toISOString();
  await save(join(directory, "run.json"), run);
  try {
    const report = await writeVerificationReport(directory);
    process.stdout.write(report.summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY, report.summary);
  } catch (error) {
    console.error(`Report generation failed: ${error.message}`);
    await writeFile(join(directory, "report-error.txt"), error.stack || error.message);
    if (run.status === "passed") run.status = "failed";
    await save(join(directory, "run.json"), run);
  }
  return { directory, run };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  let selectedStages;
  let install = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--install") install = true;
    else if (args[index] === "--stage" && args[index + 1])
      (selectedStages ??= []).push(args[++index]);
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  const { run } = await verify({ selectedStages, install });
  process.exitCode = run.status === "passed" ? 0 : 1;
}
