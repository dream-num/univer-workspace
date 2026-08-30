import { readFileSync } from "node:fs";

const evidence = JSON.parse(readFileSync(
  new URL("../test/fixtures/parity-accepted-surface.json", import.meta.url),
  "utf8",
)).safetyDimensions;

export function validateParitySafetyResults(rows, results) {
  const completed = new Map(results.map(([file, fullName, state]) => [`${file}\0${fullName}`, state]));
  const failures = [];
  for (const [caseId, dimension, file, fullName] of rows) {
    const state = completed.get(`${file}\0${fullName}`);
    if (state !== "passed") failures.push(`${caseId}:${dimension} -> ${file} > ${fullName} (${state ?? "missing"})`);
  }
  if (failures.length > 0) throw new Error(`parity safety evidence failed:\n${failures.join("\n")}`);
}

export default class ParitySafetyReporter {
  results = [];

  onTestCaseResult(testCase) {
    this.results.push([
      testCase.module.relativeModuleId,
      testCase.fullName,
      testCase.result().state,
    ]);
  }

  onTestRunEnd() {
    if (process.env.DSH_PARITY_SAFETY_REPORT === "1") {
      validateParitySafetyResults(evidence, this.results);
    }
  }
}
