import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
async function records(directory, filename) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isDirectory()) result.push(...(await records(join(directory, item.name), filename)));
    else if (item.name === filename) result.push(join(directory, item.name));
  }
  return result.sort();
}
export async function readVerificationRun(directory) {
  const run = await json(join(directory, "run.json"));
  const failures = [];
  function add(base, values) {
    const failure = {
      commit: run.commit,
      runId: run.runId,
      githubRunId: run.githubRunId,
      attempt: run.attempt,
      package: null,
      framework: null,
      file: null,
      testName: null,
      errorName: null,
      errorCode: null,
      reportPath: null,
      reportMissing: false,
      ...base,
      ...values,
    };
    failure.message = String(failure.message ?? "").slice(0, 16000);
    const normalize = (value) =>
      String(value ?? "")
        .replace(/\u001b\[[0-9;]*m/g, "")
        .replaceAll(directory, "<run>")
        .replaceAll(run.cwd, "<repo>")
        .replaceAll(run.runId, "<run-id>")
        .replace(/\/tests\/[^/\s'"]+-[a-zA-Z0-9]{6}(?=\/)/g, "/tests/<invocation>")
        .replace(/(?:\/private)?\/tmp\/[^\s:'"]+/g, "<temp>")
        .replace(/(\.[cm]?[jt]sx?):\d+(?::\d+)?/g, "$1:<line>");
    failure.signatureComponents = [
      failure.stage,
      failure.stepId,
      failure.package,
      failure.framework,
      failure.file,
      failure.testName,
      failure.errorName,
      failure.errorCode,
      normalize(failure.message),
    ];
    failure.signature = createHash("sha256")
      .update(JSON.stringify(failure.signatureComponents))
      .digest("hex");
    failures.push(failure);
  }
  for (const stageFile of await records(directory, "stage.json")) {
    const stage = await json(stageFile);
    for (const stepPath of stage.steps) {
      const stepDirectory = join(directory, stepPath);
      const step = await json(join(stepDirectory, "step.json"));
      const base = {
        stage: stage.id,
        stepId: step.id,
        stdoutPath: step.stdoutPath,
        stderrPath: step.stderrPath,
      };
      let attributedFailures = 0;
      for (const invocationFile of await records(stepDirectory, "invocation.json")) {
        let invocation;
        try {
          invocation = await json(invocationFile);
        } catch (error) {
          add(base, {
            scope: "report",
            reportMissing: true,
            errorName: "ReportInvalid",
            reportPath: relative(directory, invocationFile),
            message: error.message,
          });
          continue;
        }
        const reportPath = join(
          relative(directory, resolve(invocationFile, "..")),
          invocation.reportPath,
        );
        const invocationBase = {
          ...base,
          package: invocation.package,
          framework: invocation.framework,
          reportPath,
        };
        let invocationFailures = 0;
        try {
          if (invocation.reportMissing || invocation.status === "running")
            throw new Error(invocation.reportError || "Framework invocation did not complete");
          const content = await readFile(join(directory, reportPath), "utf8");
          if (invocation.framework === "vitest") {
            for (const suite of JSON.parse(content).testResults ?? []) {
              const failedAssertions = (suite.assertionResults ?? []).filter(
                (assertion) => assertion.status === "failed",
              );
              if (suite.status === "failed" && failedAssertions.length === 0) {
                attributedFailures++;
                invocationFailures++;
                add(invocationBase, {
                  scope: "test",
                  file: relative(run.cwd, suite.name),
                  errorName: "SuiteError",
                  message: suite.message || "Suite failed before reporting any failed test",
                });
              }
              for (const assertion of failedAssertions) {
                attributedFailures++;
                invocationFailures++;
                add(invocationBase, {
                  scope: "test",
                  file: relative(run.cwd, suite.name),
                  testName:
                    assertion.fullName ||
                    [...(assertion.ancestorTitles ?? []), assertion.title].join(" "),
                  message: assertion.failureMessages?.join("\n") || "Test failed",
                });
              }
            }
          } else {
            const events = content
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line));
            if (!events.some((event) => event.type === "report:complete"))
              throw new Error("Node reporter did not complete");
            for (const event of events.filter((event) => event.type === "test:fail")) {
              // Parent failures only repeat failures already attributed to their tests.
              if (
                event.details?.error?.failureType === "subtestsFailed" ||
                event.todo ||
                event.skip
              )
                continue;
              attributedFailures++;
              invocationFailures++;
              const error = event.details?.error?.cause ?? event.details?.error ?? {};
              add(invocationBase, {
                scope: "test",
                file: event.file ? relative(run.cwd, event.file) : null,
                testName: event.name,
                errorName: error.name,
                errorCode: error.code,
                message: error.message || "Test failed",
              });
            }
          }
        } catch (error) {
          add(invocationBase, {
            scope: "report",
            reportMissing: true,
            errorName: "ReportMissing",
            message: error.message,
          });
        }
        if (invocation.status === "failed" && invocationFailures === 0) {
          attributedFailures++;
          add(invocationBase, {
            scope: "process",
            message:
              invocation.spawnError ||
              `Framework exited with code ${invocation.exitCode}, signal ${invocation.signal ?? "none"}${invocation.interruptedBy ? `, interrupted by ${invocation.interruptedBy}` : ""}`,
            errorName: invocation.interruptedBy || invocation.signal || "ProcessExit",
            errorCode: invocation.exitCode,
          });
        }
      }
      if (step.status !== "passed" && attributedFailures === 0)
        add(base, {
          scope: "process",
          errorName: step.interruptedBy || step.signal || "ProcessExit",
          errorCode: step.exitCode,
          message:
            step.spawnError ||
            step.outputError ||
            `Step ${step.status}, exit code ${step.exitCode ?? "unknown"}, signal ${step.signal ?? "none"}${step.interruptedBy ? `, interrupted by ${step.interruptedBy}` : ""}`,
        });
    }
  }
  const lines = [
    `## Verification ${run.status}`,
    "",
    `Commit \`${run.commit}\` · attempt ${run.attempt} · ${run.dirty ? "dirty" : "clean"} checkout`,
    "",
    `Run \`${run.runId}\``,
    "",
  ];
  for (const failure of failures)
    lines.push(
      `- **${failure.stage}/${failure.stepId}** ${failure.file || failure.package || "process"}${failure.testName ? ` · ${failure.testName}` : ""}${failure.reportMissing ? " · report missing" : ""}. ${failure.message
        .split("\n")[0]
        .replace(/[\r\n]/g, " ")
        .slice(
          0,
          300,
        )} Logs: \`${failure.stderrPath}\`; report: \`${failure.reportPath ?? "none"}\`.`,
    );
  if (!failures.length)
    lines.push(
      run.status === "passed"
        ? "No recorded failures."
        : "No failure details recorded; inspect step logs and incomplete records.",
    );
  return { run, failures, summary: `${lines.join("\n")}\n` };
}
export async function writeVerificationReport(directory) {
  const report = await readVerificationRun(directory);
  await writeFile(
    join(directory, "failures.json"),
    JSON.stringify(
      { schemaVersion: 1, runId: report.run.runId, failures: report.failures },
      null,
      2,
    ),
  );
  await writeFile(join(directory, "summary.md"), report.summary);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await writeVerificationReport(resolve(process.argv[2]));
  process.stdout.write(report.summary);
}
