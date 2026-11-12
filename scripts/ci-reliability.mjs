import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const failedConclusions = new Set(["failure", "timed_out", "action_required", "startup_failure"]);

async function runGh(args) {
  const { stdout } = await exec("gh", args, { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

async function findRunFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findRunFiles(path)));
    else if (entry.isFile() && entry.name === "run.json") files.push(path);
  }
  return files;
}

async function readEvidence(gh, latest, temporaryDirectory) {
  const result = {
    matchingArtifacts: null,
    artifactsRead: 0,
    expiredArtifacts: 0,
    invalidArtifacts: 0,
    failures: [],
    errors: [],
  };
  try {
    const pages = JSON.parse(
      await gh([
        "api",
        `repos/{owner}/{repo}/actions/runs/${latest.databaseId}/artifacts?per_page=100`,
        "--paginate",
        "--slurp",
      ]),
    );
    const prefix = `verification-${latest.databaseId}-attempt-1-`;
    const artifacts = pages
      .flatMap((page) => page.artifacts)
      .filter((artifact) => artifact.name.startsWith(prefix));
    result.matchingArtifacts = artifacts.length;
    for (const artifact of artifacts) {
      if (artifact.expired) {
        result.expiredArtifacts++;
        continue;
      }
      const directory = join(temporaryDirectory, String(artifact.id));
      try {
        await gh([
          "run",
          "download",
          String(latest.databaseId),
          "--name",
          artifact.name,
          "--dir",
          directory,
        ]);
        const files = await findRunFiles(directory);
        if (!files.length) throw new Error("Artifact has no run.json");
        const artifactFailures = [];
        for (const file of files) {
          const run = JSON.parse(await readFile(file, "utf8"));
          const report = JSON.parse(await readFile(join(dirname(file), "failures.json"), "utf8"));
          if (
            run.schemaVersion !== 1 ||
            report.schemaVersion !== 1 ||
            run.runId !== report.runId ||
            String(run.githubRunId) !== String(latest.databaseId) ||
            run.attempt !== 1 ||
            (run.headCommit ?? run.commit) !== latest.headSha ||
            !Array.isArray(report.failures) ||
            report.failures.some(
              (failure) => typeof failure.signature !== "string" || !failure.signature,
            )
          ) {
            throw new Error("Artifact metadata or failure schema does not match the first attempt");
          }
          artifactFailures.push(...report.failures);
        }
        result.failures.push(...artifactFailures);
        result.artifactsRead++;
      } catch (error) {
        result.invalidArtifacts++;
        result.errors.push(`${artifact.name}: ${error.message}`);
      }
    }
  } catch (error) {
    result.errors.push(`Artifact listing failed: ${error.message}`);
  }
  return result;
}

export async function collectReliability({ limit = 20, branch, event, gh = runGh } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("--limit must be an integer from 1 to 100");
  const workflow = "ci.yml";
  const args = [
    "run",
    "list",
    "--workflow",
    workflow,
    "--limit",
    String(limit + 1),
    "--json",
    "databaseId,attempt,status,conclusion,headSha,createdAt,url,headBranch,event",
  ];
  if (branch) args.push("--branch", branch);
  if (event) args.push("--event", event);
  const repository = JSON.parse(
    await gh(["repo", "view", "--json", "nameWithOwner"]),
  ).nameWithOwner;
  const listed = JSON.parse(await gh(args));
  const latestRuns = [
    ...new Map(listed.map((run) => [String(run.databaseId), run])).values(),
  ].slice(0, limit);
  const firstPass = { successes: 0, denominator: 0, rate: null, excluded: {} };
  const coverage = {
    failedFirstAttempts: 0,
    runsWithSignatures: 0,
    runsWithoutSignatures: 0,
    runsWithMissingArtifacts: 0,
    runsWithPartialEvidence: 0,
    artifactsRead: 0,
    expiredArtifacts: 0,
    invalidArtifacts: 0,
  };
  const signatures = new Map();
  const runs = [];
  let recoveredOnRerun = 0;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "uvw-ci-reliability-"));
  try {
    for (const latest of latestRuns) {
      const row = {
        id: latest.databaseId,
        headCommit: latest.headSha,
        url: latest.url,
        createdAt: latest.createdAt,
        branch: latest.headBranch,
        event: latest.event,
        latestAttempt: latest.attempt,
        latestConclusion: latest.conclusion,
      };
      runs.push(row);
      let first = latest;
      if (latest.attempt > 1) {
        try {
          first = JSON.parse(
            await gh(["api", `repos/{owner}/{repo}/actions/runs/${latest.databaseId}/attempts/1`]),
          );
          if (
            first.run_attempt !== 1 ||
            String(first.id) !== String(latest.databaseId) ||
            first.head_sha !== latest.headSha
          ) {
            throw new Error("Attempt response does not match the sampled workflow run");
          }
        } catch (error) {
          first = {};
          row.firstAttemptError = error.message;
        }
      }
      row.firstConclusion = first.conclusion ?? null;
      const evaluable =
        first.status === "completed" &&
        (first.conclusion === "success" || failedConclusions.has(first.conclusion));
      if (!evaluable) {
        const reason =
          first.status === "completed" ? first.conclusion || "unknown" : first.status || "unknown";
        firstPass.excluded[reason] = (firstPass.excluded[reason] ?? 0) + 1;
        continue;
      }
      firstPass.denominator++;
      if (first.conclusion === "success") {
        firstPass.successes++;
        continue;
      }
      const recovered =
        latest.attempt > 1 && latest.status === "completed" && latest.conclusion === "success";
      if (recovered) recoveredOnRerun++;
      coverage.failedFirstAttempts++;
      const evidence = await readEvidence(gh, latest, temporaryDirectory);
      for (const field of ["artifactsRead", "expiredArtifacts", "invalidArtifacts"])
        coverage[field] += evidence[field];
      if (evidence.matchingArtifacts === 0) coverage.runsWithMissingArtifacts++;
      if (evidence.failures.length) coverage.runsWithSignatures++;
      else coverage.runsWithoutSignatures++;
      if (evidence.failures.length && (evidence.expiredArtifacts || evidence.errors.length))
        coverage.runsWithPartialEvidence++;
      row.evidence = {
        ...evidence,
        failures: undefined,
        status: evidence.failures.length ? "observed" : "unknown",
      };
      for (const failure of evidence.failures) {
        let signature = signatures.get(failure.signature);
        if (!signature) {
          signature = {
            signature: failure.signature,
            signatureComponents: failure.signatureComponents,
            stage: failure.stage,
            stepId: failure.stepId,
            package: failure.package,
            framework: failure.framework,
            scope: failure.scope,
            file: failure.file,
            testName: failure.testName,
            message: failure.message,
            runIds: new Set(),
            commits: new Set(),
            failingAttempts: new Set(),
            recoveredRunIds: new Set(),
          };
          signatures.set(failure.signature, signature);
        }
        signature.runIds.add(String(latest.databaseId));
        signature.commits.add(latest.headSha);
        signature.failingAttempts.add(`${latest.databaseId}:1`);
        if (recovered) signature.recoveredRunIds.add(String(latest.databaseId));
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  firstPass.rate = firstPass.denominator ? firstPass.successes / firstPass.denominator : null;
  const observedSignatures = [...signatures.values()]
    .map((signature) => ({
      ...signature,
      distinctRuns: signature.runIds.size,
      distinctCommits: signature.commits.size,
      failingAttempts: signature.failingAttempts.size,
      recoveredOnRerun: signature.recoveredRunIds.size,
      runIds: [...signature.runIds],
      commits: [...signature.commits],
      recoveredRunIds: [...signature.recoveredRunIds],
    }))
    .sort((a, b) => b.distinctRuns - a.distinctRuns || a.signature.localeCompare(b.signature));
  const dates = latestRuns.map((run) => run.createdAt).sort();
  return {
    schemaVersion: 1,
    repository,
    workflow,
    filters: { branch: branch ?? null, event: event ?? null },
    queriedAt: new Date().toISOString(),
    sample: {
      requested: limit,
      runs: latestRuns.length,
      truncated: listed.length > limit,
      from: dates[0] ?? null,
      to: dates.at(-1) ?? null,
    },
    firstPass,
    recoveredOnRerun,
    signatureAnalysis: {
      scope: "Failed first attempts only",
      commitIdentity: "GitHub workflow head SHA. PR reports may test a synthetic merge commit.",
      coverage,
      limitation:
        "Missing, expired, incomplete or pre-instrumentation reports are unknown. Observed runs may lack other stage artifacts. Later attempts are not downloaded.",
      signatures: observedSignatures,
      repeatedSignatures: observedSignatures.filter((signature) => signature.distinctRuns > 1),
    },
    runs,
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--") continue;
    if (
      !["--limit", "--branch", "--event"].includes(flag) ||
      !argv[index + 1] ||
      argv[index + 1].startsWith("--")
    ) {
      throw new Error(
        "Usage: pnpm ci:reliability [--limit 1..100] [--branch NAME] [--event EVENT]",
      );
    }
    const value = argv[++index];
    options[flag.slice(2)] = flag === "--limit" ? Number(value) : value;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Promise.resolve()
    .then(() => collectReliability(parseArguments(process.argv.slice(2))))
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
