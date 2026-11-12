import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "./verification-process.mjs";

const [framework, ...args] = process.argv.slice(2);
if (!["node", "vitest"].includes(framework))
  throw new Error("Usage: test.mjs <node|vitest> [test arguments]");
const cwd = process.cwd();
const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
const reportRoot = process.env.UVW_VERIFY_REPORT_DIR;
let directory;
let invocation;
if (reportRoot) {
  await mkdir(reportRoot, { recursive: true });
  directory = await mkdtemp(
    join(resolve(reportRoot), `${manifest.name.replace(/[^a-zA-Z0-9-]/g, "-")}-`),
  );
  invocation = {
    package: manifest.name,
    framework,
    cwd,
    argv: args,
    startedAt: new Date().toISOString(),
    status: "running",
    reportPath: framework === "node" ? "events.ndjson" : "report.json",
  };
  await writeFile(join(directory, "invocation.json"), JSON.stringify(invocation, null, 2));
}
let argv;
if (framework === "node") {
  argv = [process.execPath, "--test"];
  if (directory)
    argv.push(
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      `--test-reporter=${fileURLToPath(new URL("./node-test-reporter.mjs", import.meta.url))}`,
      `--test-reporter-destination=${join(directory, invocation.reportPath)}`,
    );
} else {
  const require = createRequire(join(cwd, "package.json"));
  argv = [process.execPath, join(dirname(require.resolve("vitest/package.json")), "vitest.mjs")];
}
argv.push(...args);
if (directory && framework === "vitest")
  argv.push(
    "--reporter=default",
    "--reporter=json",
    `--outputFile=${join(directory, invocation.reportPath)}`,
  );
const result = await runProcess(argv);
let collectionFailed = false;
if (directory) {
  let reportError = null;
  try {
    const data = await readFile(join(directory, invocation.reportPath), "utf8");
    if (framework === "vitest") JSON.parse(data);
    else if (
      !data
        .trim()
        .split("\n")
        .some((line) => JSON.parse(line).type === "report:complete")
    )
      throw new Error("Node reporter did not complete");
  } catch (error) {
    reportError = error.message;
  }
  collectionFailed = Boolean(reportError);
  Object.assign(invocation, result, {
    finishedAt: new Date().toISOString(),
    reportMissing: Boolean(reportError),
    reportError,
  });
  await writeFile(join(directory, "invocation.json"), JSON.stringify(invocation, null, 2));
}
process.exitCode = result.exitCode || (result.status === "passed" && !collectionFailed ? 0 : 1);
