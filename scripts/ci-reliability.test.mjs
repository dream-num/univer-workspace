import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { collectReliability } from "./ci-reliability.mjs";

const run = (id, conclusion = "failure", values = {}) => ({
  databaseId: id,
  attempt: 1,
  status: "completed",
  conclusion,
  headSha: `commit-${id}`,
  createdAt: `2026-11-${String(id).padStart(2, "0")}T00:00:00Z`,
  url: `https://github.com/test/repo/actions/runs/${id}`,
  headBranch: "main",
  event: "push",
  ...values,
});
const failure = (signature = "same-failure", values = {}) => ({
  signature,
  signatureComponents: ["test-rest", "tests", signature],
  stage: "test-rest",
  stepId: "tests",
  package: "test-package",
  framework: "node",
  scope: "test",
  file: "test/sample.test.mjs",
  testName: "sample test",
  message: "Expected 2, received 1",
  ...values,
});

function fixture(runs, reports = {}, firstAttempts = {}) {
  const calls = [];
  const artifacts = new Map();
  for (const [id, stages] of Object.entries(reports)) {
    for (const [index, stage] of stages.entries()) {
      const artifact = {
        id: `${id}-${index}`,
        name: `verification-${id}-attempt-${stage.attempt ?? 1}-${stage.stage ?? index}`,
        expired: stage.expired ?? false,
      };
      artifacts.set(artifact.name, {
        artifact,
        stage,
        run: runs.find((item) => String(item.databaseId) === id),
      });
    }
  }
  const gh = async (args) => {
    calls.push(args);
    if (args[0] === "repo") return JSON.stringify({ nameWithOwner: "test/repo" });
    if (args[0] === "run" && args[1] === "list") return JSON.stringify(runs);
    if (args[0] === "api") {
      const match = args[1].match(/\/runs\/(\d+)\/(attempts\/1|artifacts)/);
      assert.ok(match, `Unexpected API call ${args}`);
      const [, id, kind] = match;
      if (kind === "attempts/1") {
        if (firstAttempts[id] instanceof Error) throw firstAttempts[id];
        return JSON.stringify({
          id: Number(id),
          run_attempt: 1,
          head_sha: `commit-${id}`,
          status: "completed",
          conclusion: firstAttempts[id] ?? "failure",
        });
      }
      assert.ok(args.includes("--paginate"));
      assert.ok(args.includes("--slurp"));
      const matching = [...artifacts.values()].filter((item) => String(item.run.databaseId) === id);
      return JSON.stringify(matching.map((item) => ({ artifacts: [item.artifact] })));
    }
    if (args[0] === "run" && args[1] === "download") {
      const { stage, run: latest } = artifacts.get(args[args.indexOf("--name") + 1]);
      if (stage.downloadError) throw new Error("Artifact disappeared");
      const directory = join(
        args[args.indexOf("--dir") + 1],
        ".verification",
        `unique-${stage.stage ?? 0}`,
      );
      await mkdir(directory, { recursive: true });
      const metadata = {
        schemaVersion: 1,
        runId: `unique-${stage.stage ?? 0}`,
        githubRunId: String(latest.databaseId),
        commit: latest.headSha,
        attempt: stage.attempt ?? 1,
        selectedStages: [stage.stage ?? "test-rest"],
        ...stage.metadata,
      };
      await writeFile(join(directory, "run.json"), JSON.stringify(metadata));
      if (!stage.missingReport)
        await writeFile(
          join(directory, "failures.json"),
          stage.corruptReport
            ? "{"
            : JSON.stringify({
                schemaVersion: 1,
                runId: metadata.runId,
                failures: stage.failures ?? [],
              }),
        );
      if (stage.extraInvalidRun) {
        const extra = join(directory, "zzz-incomplete");
        await mkdir(extra);
        await writeFile(join(extra, "run.json"), JSON.stringify(metadata));
      }
      return "";
    }
    throw new Error(`Unexpected gh command ${args}`);
  };
  return { gh, calls };
}

test("first attempts determine the rate even after green reruns, with cancellation and incomplete runs excluded", async () => {
  const { gh, calls } = fixture(
    [
      run(1, "success", { attempt: 2 }),
      run(2, "success"),
      run(3, "cancelled"),
      run(4, null, { status: "in_progress" }),
      run(5, "success", { attempt: 3 }),
      run(6, "neutral"),
    ],
    { 1: [{ failures: [failure()] }, { attempt: 2, failures: [] }] },
    { 5: "cancelled" },
  );
  const report = await collectReliability({ gh });
  assert.deepEqual(report.firstPass, {
    successes: 1,
    denominator: 2,
    rate: 0.5,
    excluded: { cancelled: 2, in_progress: 1, neutral: 1 },
  });
  assert.equal(report.recoveredOnRerun, 1);
  assert.equal(report.signatureAnalysis.signatures[0].recoveredOnRerun, 1);
  assert.equal(calls.filter((args) => args[1] === "download").length, 1);
  assert.equal(report.sample.from, "2026-11-01T00:00:00Z");
  assert.equal(report.sample.to, "2026-11-06T00:00:00Z");
});

test("recurrence counts distinct workflows, commits and first attempts across separate stage artifacts", async () => {
  const { gh } = fixture([run(1), run(1), run(2), run(3, "failure", { headSha: "commit-2" })], {
    1: [
      { stage: "test-rest", failures: [failure(), failure()] },
      { stage: "test-mcp", failures: [failure()] },
    ],
    2: [{ stage: "test-rest", failures: [failure()] }],
    3: [{ stage: "test-rest", failures: [failure()] }],
  });
  const report = await collectReliability({ gh });
  assert.equal(report.sample.runs, 3);
  assert.equal(report.firstPass.denominator, 3);
  assert.equal(report.signatureAnalysis.coverage.artifactsRead, 4);
  const repeated = report.signatureAnalysis.repeatedSignatures;
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].distinctRuns, 3);
  assert.equal(repeated[0].distinctCommits, 2);
  assert.equal(repeated[0].failingAttempts, 3);
  assert.deepEqual(repeated[0].runIds, ["1", "2", "3"]);
});

test("missing, expired and malformed artifacts remain unknown, with first-attempt failures still in the denominator", async () => {
  const { gh } = fixture([run(1), run(2), run(3), run(4), run(5)], {
    2: [{ expired: true, failures: [failure()] }],
    3: [{ missingReport: true }],
    4: [{ corruptReport: true }],
    5: [{ downloadError: true }],
  });
  const report = await collectReliability({ gh });
  assert.equal(report.firstPass.denominator, 5);
  assert.equal(report.firstPass.rate, 0);
  assert.equal(report.signatureAnalysis.coverage.runsWithoutSignatures, 5);
  assert.equal(report.signatureAnalysis.coverage.runsWithMissingArtifacts, 1);
  assert.equal(report.signatureAnalysis.coverage.expiredArtifacts, 1);
  assert.equal(report.signatureAnalysis.coverage.invalidArtifacts, 3);
  assert.deepEqual(report.signatureAnalysis.signatures, []);
  assert.ok(report.runs.every((item) => item.evidence.status === "unknown"));
});

test("historical five-stage runs and partial evidence do not assume the current stage count", async () => {
  const { gh } = fixture([run(1), run(2)], {
    1: Array.from({ length: 5 }, (_, index) => ({
      stage: `old-${index}`,
      failures: index ? [] : [failure()],
    })),
    2: [{ failures: [failure()] }, { stage: "expired", expired: true }],
  });
  const report = await collectReliability({ gh });
  assert.equal(report.signatureAnalysis.coverage.artifactsRead, 6);
  assert.equal(report.signatureAnalysis.coverage.runsWithSignatures, 2);
  assert.equal(report.signatureAnalysis.coverage.runsWithPartialEvidence, 1);
  assert.equal(report.signatureAnalysis.repeatedSignatures[0].distinctRuns, 2);
});

test("mismatched attempt metadata cannot count as preserved first-attempt evidence", async () => {
  const { gh } = fixture([run(1)], { 1: [{ metadata: { attempt: 2 }, failures: [failure()] }] });
  const report = await collectReliability({ gh });
  assert.equal(report.signatureAnalysis.coverage.invalidArtifacts, 1);
  assert.equal(report.signatureAnalysis.coverage.runsWithoutSignatures, 1);
});

test("PR reports retain the tested merge commit while matching the workflow head commit", async () => {
  const { gh } = fixture([run(1)], {
    1: [{ metadata: { commit: "synthetic-merge", headCommit: "commit-1" }, failures: [failure()] }],
  });
  const report = await collectReliability({ gh });
  assert.equal(report.signatureAnalysis.coverage.runsWithSignatures, 1);
  assert.deepEqual(report.signatureAnalysis.signatures[0].commits, ["commit-1"]);
});

test("an invalid second run record rejects the whole artifact instead of leaking partial signatures", async () => {
  const { gh } = fixture([run(1)], {
    1: [{ extraInvalidRun: true, failures: [failure()] }],
  });
  const report = await collectReliability({ gh });
  assert.equal(report.signatureAnalysis.coverage.invalidArtifacts, 1);
  assert.equal(report.signatureAnalysis.coverage.runsWithSignatures, 0);
  assert.deepEqual(report.signatureAnalysis.signatures, []);
});

test("unavailable exact first-attempt responses stay unknown rather than borrowing latest green status", async () => {
  const { gh } = fixture(
    [run(1, "success", { attempt: 2 }), run(2, "success", { attempt: 2 })],
    {},
    { 1: new Error("Attempt unavailable"), 2: "failure" },
  );
  const report = await collectReliability({ gh });
  assert.equal(report.firstPass.denominator, 1);
  assert.equal(report.firstPass.successes, 0);
  assert.equal(report.firstPass.excluded.unknown, 1);
  assert.match(report.runs[0].firstAttemptError, /unavailable/);
});

test("bounds the requested sample, records filters and distinguishes zero eligible runs from a zero rate", async () => {
  const { gh, calls } = fixture([run(3, "success"), run(2, "success"), run(1, "success")]);
  const report = await collectReliability({ gh, limit: 2, branch: "topic", event: "pull_request" });
  assert.equal(report.sample.runs, 2);
  assert.equal(report.sample.truncated, true);
  assert.deepEqual(report.filters, { branch: "topic", event: "pull_request" });
  assert.ok(
    calls.some(
      (args) =>
        args.includes("--branch") && args.includes("topic") && args.includes("pull_request"),
    ),
  );
  const empty = await collectReliability({ gh: fixture([]).gh });
  assert.equal(empty.firstPass.rate, null);
  assert.equal(empty.firstPass.denominator, 0);
  for (const limit of [0, 101, NaN, 1.5])
    await assert.rejects(collectReliability({ gh, limit }), /--limit/);
});
