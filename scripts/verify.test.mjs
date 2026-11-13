import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import test from "node:test";
import { verify, stages } from "./verify.mjs";
import { runProcess } from "./verification-process.mjs";
import { readVerificationRun } from "./verification-report.mjs";

for (const name of [
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_ACTIONS",
  "GITHUB_STEP_SUMMARY",
  "UVW_VERIFY_HEAD_SHA",
])
  delete process.env[name];

const root = resolve(import.meta.dirname, "..");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
async function scratch(t, parent = tmpdir()) {
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "verification-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("process close preserves exit, signal, spawn error and drained logs", async (t) => {
  const directory = await scratch(t);
  const result = await runProcess(
    [
      process.execPath,
      "-e",
      'process.stdout.write("last stdout");process.stderr.write("last stderr");process.exitCode=7',
    ],
    { directory },
  );
  assert.equal(result.exitCode, 7);
  assert.equal(result.signal, null);
  assert.equal(result.status, "failed");
  assert.equal(await readFile(join(directory, "stdout.log"), "utf8"), "last stdout");
  assert.equal(await readFile(join(directory, "stderr.log"), "utf8"), "last stderr");
  const signal = await runProcess([process.execPath, "-e", 'process.kill(process.pid,"SIGTERM")']);
  assert.equal(signal.exitCode, null);
  assert.equal(signal.signal, "SIGTERM");
  const missing = await runProcess([join(directory, "missing-executable")]);
  assert.match(missing.spawnError, /ENOENT/);
});

test("ordered steps stop at a failure and each run retains its own evidence", async (t) => {
  const outputRoot = await scratch(t);
  const prepared = join(outputRoot, "prepared");
  const registry = {
    fixture: [
      {
        id: "prepare",
        argv: [
          process.execPath,
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(prepared)},"prepared")`,
        ],
      },
      {
        id: "failure",
        argv: [
          process.execPath,
          "-e",
          `require("node:assert/strict").equal(require("node:fs").readFileSync(${JSON.stringify(prepared)},"utf8"),"prepared");process.exit(7)`,
        ],
      },
      { id: "must-not-run", argv: [process.execPath, "-e", "process.exit(0)"] },
    ],
  };
  process.env.UVW_VERIFY_HEAD_SHA = "pr-head-commit";
  t.after(() => {
    delete process.env.UVW_VERIFY_HEAD_SHA;
  });
  const first = await verify({ selectedStages: ["fixture"], outputRoot, registry });
  const second = await verify({ selectedStages: ["fixture"], outputRoot, registry });
  assert.notEqual(first.directory, second.directory);
  assert.equal(first.run.status, "failed");
  assert.equal(first.run.headCommit, "pr-head-commit");
  assert.notEqual(first.run.commit, first.run.headCommit);
  const stage = await json(join(first.directory, "attempt-1/fixture/stage.json"));
  assert.deepEqual(
    stage.steps.map((path) => path.split("/").at(-1)),
    ["01-prepare", "02-failure"],
  );
  const failures = await json(join(first.directory, "failures.json"));
  assert.equal(failures.failures[0].errorCode, 7);
  assert.equal(failures.failures[0].stepId, "failure");
  assert.equal((await json(join(first.directory, "run.json"))).runId, first.run.runId);
  assert.ok(stages["test-rest"].find((step) => step.id === "verification-tools"));
});

test("report generation failure cannot overwrite a failing process status", async (t) => {
  const outputRoot = await scratch(t);
  const source =
    'const fs=require("node:fs");const p=require("node:path");fs.mkdirSync(p.resolve(process.env.UVW_VERIFY_REPORT_DIR,"../../../..","failures.json"),{recursive:true});process.exit(7)';
  const result = await verify({
    selectedStages: ["fixture"],
    outputRoot,
    registry: { fixture: [{ id: "invalid-report", argv: [process.execPath, "-e", source] }] },
  });
  assert.equal(result.run.status, "failed");
  assert.match(await readFile(join(result.directory, "report-error.txt"), "utf8"), /EISDIR/);
  const stage = await json(join(result.directory, "attempt-1/fixture/stage.json"));
  assert.equal((await json(join(result.directory, stage.steps[0], "step.json"))).exitCode, 7);
});

test("real Node and Vitest failures keep test identities in separate concurrent invocations", async (t) => {
  const fixtures = await scratch(t, join(root, ".verification"));
  const reports = join(fixtures, "reports");
  const nodeFixture = join(fixtures, "failure.node.mjs");
  const vitestFixture = join(fixtures, "failure.test.mjs");
  const config = join(fixtures, "vitest.config.mjs");
  const collectionFixture = join(fixtures, "collection.test.mjs");
  await writeFile(
    nodeFixture,
    'import test from "node:test";import assert from "node:assert/strict";test("node identity",()=>assert.equal(1,2));',
  );
  await writeFile(
    vitestFixture,
    'import {test,expect} from "vitest";test("vitest identity",()=>expect(1).toBe(2));',
  );
  await writeFile(collectionFixture, 'throw new Error("native module startup failure");');
  await writeFile(
    config,
    `export default {test:{include:${JSON.stringify([vitestFixture, collectionFixture])},maxWorkers:1}};`,
  );
  const commands = [
    ["node", nodeFixture],
    ["node", nodeFixture],
    ["vitest", "run", "--config", config],
  ];
  const fixtureEnv = { ...process.env, UVW_VERIFY_REPORT_DIR: reports };
  delete fixtureEnv.NODE_TEST_CONTEXT;
  const results = await Promise.all(
    commands.map((args) =>
      runProcess([process.execPath, join(root, "scripts/test.mjs"), ...args], {
        cwd: root,
        env: fixtureEnv,
      }),
    ),
  );
  assert.ok(results.every((result) => result.exitCode !== 0));
  const entries = await readdir(reports);
  assert.equal(entries.length, 3);
  const invocations = await Promise.all(
    entries.map((entry) => json(join(reports, entry, "invocation.json"))),
  );
  assert.ok(invocations.every((invocation) => invocation.reportMissing === false));
  const nodeReport = await readFile(
    join(
      reports,
      entries[invocations.findIndex((invocation) => invocation.framework === "node")],
      "events.ndjson",
    ),
    "utf8",
  );
  assert.match(nodeReport, /node identity/);
  assert.match(nodeReport, /ERR_ASSERTION/);
  const vitestReport = await json(
    join(
      reports,
      entries[invocations.findIndex((invocation) => invocation.framework === "vitest")],
      "report.json",
    ),
  );
  assert.equal(
    vitestReport.testResults.find((suite) => suite.name === vitestFixture).assertionResults[0]
      .fullName,
    "vitest identity",
  );
  const runDirectory = join(fixtures, "normalized");
  const stepDirectory = join(runDirectory, "attempt-1/fixture/01-tests");
  await mkdir(stepDirectory, { recursive: true });
  await writeFile(
    join(runDirectory, "run.json"),
    JSON.stringify({ runId: "fixture", commit: "abc", cwd: root, attempt: 1, status: "failed" }),
  );
  await writeFile(
    join(runDirectory, "attempt-1/fixture/stage.json"),
    JSON.stringify({ id: "fixture", steps: ["attempt-1/fixture/01-tests"] }),
  );
  await writeFile(
    join(stepDirectory, "step.json"),
    JSON.stringify({ id: "tests", status: "failed", exitCode: 1 }),
  );
  const { cp } = await import("node:fs/promises");
  await cp(reports, join(stepDirectory, "tests"), { recursive: true });
  await mkdir(join(stepDirectory, "tests/crashed"));
  await writeFile(
    join(stepDirectory, "tests/crashed/invocation.json"),
    JSON.stringify({
      framework: "node",
      package: "crashed-after-tests",
      reportPath: "events.ndjson",
      status: "failed",
      exitCode: null,
      signal: "SIGTERM",
      reportMissing: false,
    }),
  );
  await writeFile(
    join(stepDirectory, "tests/crashed/events.ndjson"),
    JSON.stringify({ type: "report:complete" }) + "\n",
  );
  const report = await readVerificationRun(runDirectory);
  assert.equal(report.failures.filter((failure) => failure.scope === "test").length, 4);
  assert.ok(
    report.failures
      .filter((failure) => failure.scope === "test")
      .every((failure) => failure.signature && failure.file?.startsWith(".verification/")),
  );
  assert.ok(
    report.failures.some(
      (failure) =>
        failure.file?.endsWith("collection.test.mjs") &&
        failure.testName === null &&
        failure.message.includes("native module startup failure") &&
        failure.errorName === "SuiteError",
    ),
  );
  assert.ok(
    report.failures.some(
      (failure) =>
        failure.scope === "process" &&
        failure.package === "crashed-after-tests" &&
        failure.errorName === "SIGTERM",
    ),
  );
});

test("missing framework output is explicit even when child status was green", async (t) => {
  const directory = await scratch(t);
  const stepDirectory = join(directory, "attempt-1/fixture/01-tests");
  await mkdir(join(stepDirectory, "tests/missing"), { recursive: true });
  await writeFile(
    join(directory, "run.json"),
    JSON.stringify({ runId: "fixture", cwd: root, attempt: 1, status: "failed" }),
  );
  await writeFile(
    join(directory, "attempt-1/fixture/stage.json"),
    JSON.stringify({ id: "fixture", steps: ["attempt-1/fixture/01-tests"] }),
  );
  await writeFile(
    join(stepDirectory, "step.json"),
    JSON.stringify({ id: "tests", status: "failed", exitCode: 1 }),
  );
  await writeFile(
    join(stepDirectory, "tests/missing/invocation.json"),
    JSON.stringify({
      framework: "vitest",
      package: "fixture",
      reportPath: "report.json",
      status: "passed",
      exitCode: 0,
      reportMissing: true,
      reportError: "No JSON after worker crash",
    }),
  );
  const report = await readVerificationRun(directory);
  assert.equal(report.failures[0].reportMissing, true);
  assert.match(report.summary, /report missing/);
  assert.ok(report.failures.some((failure) => failure.scope === "process"));
});

test(
  "SIGTERM forwards to the command process group and leaves a closed record",
  { skip: process.platform === "win32" },
  async (t) => {
    const directory = await scratch(t);
    const helper = join(directory, "forward.mjs");
    const pidFile = join(directory, "pid");
    const childCode = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`;
    const parentCode = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit'});setInterval(()=>{},1000)`;
    await writeFile(
      helper,
      `import {runProcess} from ${JSON.stringify(new URL("./verification-process.mjs", import.meta.url).href)};const result=await runProcess([process.execPath,'-e',${JSON.stringify(parentCode)}],{processGroup:true});console.log(JSON.stringify(result));`,
    );
    const child = spawn(process.execPath, [helper], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    const completed = once(child, "close");
    let descendant;
    for (let count = 0; count < 100; count++) {
      try {
        descendant = Number(await readFile(pidFile, "utf8"));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    assert.ok(descendant);
    child.kill("SIGTERM");
    await completed;
    assert.equal(JSON.parse(output.trim()).signal, "SIGTERM");
    let running = true;
    for (let count = 0; count < 50 && running; count++) {
      try {
        process.kill(descendant, 0);
        if (process.platform === "linux")
          running = !/\) Z /.test(await readFile(`/proc/${descendant}/stat`, "utf8"));
      } catch (error) {
        if (!["ESRCH", "ENOENT"].includes(error.code)) throw error;
        running = false;
      }
      if (running) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(running, false, "command descendant must no longer be running");
  },
);

test("framework termination records signal and marks absent report", async (t) => {
  const fixtures = await scratch(t, join(root, ".verification"));
  const config = join(fixtures, "signal.config.mjs");
  const reports = join(fixtures, "reports");
  await writeFile(config, 'process.kill(process.pid,"SIGKILL"); export default {};');
  const result = await runProcess(
    [process.execPath, join(root, "scripts/test.mjs"), "vitest", "run", "--config", config],
    { cwd: root, env: { ...process.env, UVW_VERIFY_REPORT_DIR: reports } },
  );
  assert.notEqual(result.exitCode, 0);
  const [entry] = await readdir(reports);
  const invocation = await json(join(reports, entry, "invocation.json"));
  assert.equal(invocation.signal, "SIGKILL");
  assert.equal(invocation.exitCode, null);
  assert.equal(invocation.reportMissing, true);
});

test("log write failure is recorded without masking child termination", async (t) => {
  const directory = await scratch(t);
  await mkdir(join(directory, "stdout.log"));
  const result = await runProcess(
    [process.execPath, "-e", 'process.stdout.write("output");process.exitCode=7'],
    { directory },
  );
  assert.equal(result.exitCode, 7);
  assert.equal(result.status, "failed");
  assert.match(result.outputError, /EEXIST/);
});

test(
  "interruption stops verification even when the command handles SIGTERM and exits zero",
  { skip: process.platform === "win32" },
  async (t) => {
    const directory = await scratch(t);
    const outputRoot = join(directory, "runs");
    const ready = join(directory, "ready");
    const later = join(directory, "later");
    const helper = join(directory, "interrupt.mjs");
    const graceful = `process.on("SIGTERM",()=>process.exit(0));require("node:fs").writeFileSync(${JSON.stringify(ready)},"ready");setInterval(()=>{},1000)`;
    const registry = {
      fixture: [
        { id: "graceful", argv: [process.execPath, "-e", graceful] },
        {
          id: "later",
          argv: [
            process.execPath,
            "-e",
            `require("node:fs").writeFileSync(${JSON.stringify(later)},"ran")`,
          ],
        },
      ],
    };
    await writeFile(
      helper,
      `import {verify} from ${JSON.stringify(new URL("./verify.mjs", import.meta.url).href)};await verify({outputRoot:${JSON.stringify(outputRoot)},selectedStages:["fixture"],registry:${JSON.stringify(registry)}});`,
    );
    const child = spawn(process.execPath, [helper], { stdio: "ignore" });
    const completed = once(child, "close");
    for (let count = 0; count < 100; count++) {
      try {
        await readFile(ready);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    assert.equal(await readFile(ready, "utf8"), "ready");
    child.kill("SIGTERM");
    await completed;
    const [entry] = await readdir(outputRoot);
    const runDirectory = join(outputRoot, entry);
    assert.equal((await json(join(runDirectory, "run.json"))).status, "failed");
    const stage = await json(join(runDirectory, "attempt-1/fixture/stage.json"));
    assert.equal(stage.steps.length, 1);
    const step = await json(join(runDirectory, stage.steps[0], "step.json"));
    assert.equal(step.exitCode, 0);
    assert.equal(step.signal, null);
    assert.equal(step.interruptedBy, "SIGTERM");
    assert.equal(step.status, "failed");
    await assert.rejects(readFile(later), { code: "ENOENT" });
    assert.match(
      await readFile(join(runDirectory, "summary.md"), "utf8"),
      /interrupted by SIGTERM/,
    );
  },
);

test("failure signatures ignore checkout roots and source locations but retain meaningful numbers", async (t) => {
  const outputRoot = await scratch(t);
  async function signature(name, cwd, line, expected, ansi = false) {
    const directory = join(outputRoot, name);
    const step = "attempt-1/fixture/01-tests";
    const invocation = join(directory, step, "tests/fixture-ABC123");
    await mkdir(invocation, { recursive: true });
    await writeFile(
      join(directory, "run.json"),
      JSON.stringify({ runId: name, cwd, attempt: 1, status: "failed" }),
    );
    await writeFile(
      join(directory, "attempt-1/fixture/stage.json"),
      JSON.stringify({ id: "fixture", steps: [step] }),
    );
    await writeFile(
      join(directory, step, "step.json"),
      JSON.stringify({ id: "tests", status: "failed", exitCode: 1 }),
    );
    await writeFile(
      join(invocation, "invocation.json"),
      JSON.stringify({
        package: "fixture",
        framework: "vitest",
        status: "failed",
        exitCode: 1,
        reportPath: "report.json",
        reportMissing: false,
      }),
    );
    const message = `Error: expected value:${expected} at ${cwd}/example.test.ts:${line}:3`;
    await writeFile(
      join(invocation, "report.json"),
      JSON.stringify({
        testResults: [
          {
            name: `${cwd}/example.test.ts`,
            status: "failed",
            assertionResults: [
              {
                status: "failed",
                fullName: "stable identity",
                failureMessages: [ansi ? `\u001b[31m${message}\u001b[0m` : message],
              },
            ],
          },
        ],
      }),
    );
    const report = await readVerificationRun(directory);
    assert.equal(report.failures.length, 1);
    return report.failures[0].signature;
  }
  const first = await signature("first", "/checkout/a", 12, 2);
  assert.equal(await signature("second", "/checkout/b", 89, 2, true), first);
  assert.notEqual(await signature("third", "/checkout/c", 89, 3), first);
});
