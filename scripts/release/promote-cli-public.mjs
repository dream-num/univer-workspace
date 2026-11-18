import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const PACKAGE = "univer-workspace-cli";
export const INSIDER = "https://insider-npm-registry.univer.work/";
export const PUBLIC = "https://registry.npmjs.org/";
const TARBALL = "univer-workspace-cli.tgz";
const RECORD = "promotion.json";

export function validateVersion(version) {
  // Only the CLI's stable/latest channel is eligible in this first workflow.
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version ?? "")) {
    throw new Error("An exact stable X.Y.Z version is required.");
  }
  return version;
}

export function assertPublishContext(env) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REPOSITORY !== "dream-num/univer-workspace" ||
    !env.BASE_BRANCH ||
    env.GITHUB_REF !== `refs/heads/${env.BASE_BRANCH}` ||
    env.GITHUB_WORKFLOW_REF !==
      `dream-num/univer-workspace/.github/workflows/promote-cli-public.yml@refs/heads/${env.BASE_BRANCH}` ||
    !env.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  ) {
    throw new Error(
      "Public publication requires manual dispatch of promote-cli-public.yml on the default branch with OIDC.",
    );
  }
}

function integrity(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

async function response(url, options, fetcher) {
  const result = await fetcher(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
  if (!result.ok) {
    // Registry errors are public diagnostics; never print request headers or credentials.
    const body = await result.text();
    throw new Error(`Registry request failed (${result.status}): ${body}`);
  }
  return result;
}

function assertPlan(plan, version) {
  const selected = plan?.packages?.[0];
  if (
    plan?.status !== "completed" ||
    plan.dryRun !== true ||
    plan.publicRegistryWriteVerified !== false ||
    plan.packageCount !== 1 ||
    plan.packages?.length !== 1 ||
    selected?.name !== PACKAGE ||
    selected.version !== version ||
    !["publish", "reuse"].includes(selected.publicVersion)
  ) {
    throw new Error("Promotion dry-run did not return the exact completed CLI-only plan.");
  }
}

async function readTarball(path, version) {
  const { stdout } = await execute("tar", ["-xOzf", path, "package/package.json"], {
    maxBuffer: 1024 * 1024,
  });
  const manifest = JSON.parse(stdout);
  if (manifest.name !== PACKAGE || manifest.version !== version || manifest.private === true) {
    throw new Error("Original tarball manifest does not match the publishable CLI version.");
  }
  return manifest;
}

export async function preparePromotion({ version, directory, env = process.env, fetcher = fetch }) {
  validateVersion(version);
  if (!env.INSIDER_TOKEN) throw new Error("INSIDER_TOKEN is required for Promotion dry-run.");
  await mkdir(directory, { recursive: true });
  // Remove stale output first: a failed preparation must never leave a publishable record.
  await rm(join(directory, RECORD), { force: true });
  const plan = await (
    await response(
      `${INSIDER}-/insider/v1/promotions?wait=true&dryRun=true`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.INSIDER_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ packages: [{ name: PACKAGE, version }] }),
      },
      fetcher,
    )
  ).json();
  assertPlan(plan, version);
  const metadata = await (await response(`${INSIDER}${PACKAGE}/${version}`, {}, fetcher)).json();
  if (metadata.name !== PACKAGE || metadata.version !== version) {
    throw new Error("Insider metadata does not match the selected version.");
  }
  const tarballUrl = new URL(metadata.dist?.tarball);
  if (tarballUrl.origin !== new URL(INSIDER).origin || tarballUrl.username || tarballUrl.password) {
    throw new Error("The selected tarball must still be hosted by insider-npm.");
  }
  const bytes = Buffer.from(await (await response(tarballUrl, {}, fetcher)).arrayBuffer());
  const hash = integrity(bytes);
  if (hash !== metadata.dist?.integrity) throw new Error("Original tarball integrity mismatch.");
  const tarballPath = join(directory, TARBALL);
  await writeFile(tarballPath, bytes);
  await readTarball(tarballPath, version);
  const record = {
    package: PACKAGE,
    version,
    registry: PUBLIC,
    tag: "latest",
    integrity: hash,
    tarball: TARBALL,
    sourceTarball: tarballUrl.href,
    sourceSha: env.GITHUB_SHA ?? null,
    runId: env.GITHUB_RUN_ID ?? null,
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    plan,
  };
  await writeFile(join(directory, RECORD), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

// Explicit flags override publishConfig from the original manifest. No repacking.
export function npmPublishArguments(tarball, registry = PUBLIC) {
  return [
    "publish",
    tarball,
    `--registry=${registry}`,
    "--tag=latest",
    "--access=public",
    "--ignore-scripts",
    "--provenance=false",
    "--userconfig=/dev/null",
  ];
}

export async function publishTarball(tarball, env, registry = PUBLIC) {
  const directory = await mkdtemp(join(tmpdir(), "cli-public-npm-"));
  try {
    // Keep only runner/OIDC context. In particular, do not pass insider credentials,
    // user npm configuration, token auth, or checkout .npmrc to the public publisher.
    const cleanEnv = Object.fromEntries(
      Object.entries(env).filter(
        ([key]) => ["PATH", "CI", "SYSTEMROOT"].includes(key) || /^(GITHUB_|ACTIONS_)/u.test(key),
      ),
    );
    cleanEnv.HOME = directory;
    cleanEnv.NPM_CONFIG_CACHE = join(directory, "cache");
    cleanEnv.NPM_CONFIG_GLOBALCONFIG = join(directory, "empty-global.npmrc");
    const { stdout, stderr } = await execute(
      "npm",
      npmPublishArguments(resolve(tarball), registry),
      {
        cwd: directory,
        env: cleanEnv,
        timeout: 300_000,
        maxBuffer: 1024 * 1024,
      },
    );
    return { stdout, stderr };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function publicVersion(version, fetcher) {
  const result = await fetcher(`${PUBLIC}${PACKAGE}/${version}`, {
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
    headers: { "cache-control": "no-cache" },
  });
  if (result.status === 404) return undefined;
  if (!result.ok) throw new Error(`Public version readback failed (${result.status}).`);
  return result.json();
}

function assertPublicVersion(metadata, record) {
  if (
    metadata?.name !== PACKAGE ||
    metadata.version !== record.version ||
    metadata.dist?.integrity !== record.integrity
  ) {
    throw new Error("Public exact-version/integrity readback does not match the original tarball.");
  }
}

export async function publishPromotion({
  version,
  directory,
  env = process.env,
  fetcher = fetch,
  publisher = publishTarball,
}) {
  validateVersion(version);
  assertPublishContext(env);
  const record = JSON.parse(await readFile(join(directory, RECORD), "utf8"));
  assertPlan(record.plan, version);
  if (
    record.package !== PACKAGE ||
    record.version !== version ||
    record.registry !== PUBLIC ||
    record.tag !== "latest" ||
    record.tarball !== TARBALL ||
    !env.GITHUB_SHA ||
    record.sourceSha !== env.GITHUB_SHA ||
    !env.GITHUB_RUN_ID ||
    record.runId !== env.GITHUB_RUN_ID ||
    !env.GITHUB_RUN_ATTEMPT ||
    record.runAttempt !== env.GITHUB_RUN_ATTEMPT
  )
    throw new Error("Prepared promotion must belong to this workflow run and exact version.");
  const path = join(directory, TARBALL);
  if (integrity(await readFile(path)) !== record.integrity)
    throw new Error("Prepared tarball integrity mismatch.");
  await readTarball(path, version);
  const existing = await publicVersion(version, fetcher);
  let action = "reused";
  if (existing) {
    assertPublicVersion(existing, record);
  } else {
    // No blind retry on publish failure: its outcome may be uncertain.
    await publisher(path, env);
    action = "published";
  }
  assertPublicVersion(await publicVersion(version, fetcher), record);
  return { ...record, action, publicRegistryWriteVerified: action === "published" };
}

async function main() {
  const args = process.argv.slice(2);
  const publish = args.includes("--publish");
  const versionArgs = args.filter((arg) => arg.startsWith("--version="));
  if (
    versionArgs.length !== 1 ||
    args.some((arg) => arg !== "--publish" && !arg.startsWith("--version="))
  ) {
    throw new Error(
      "Usage: node scripts/release/promote-cli-public.mjs --version=X.Y.Z [--publish]",
    );
  }
  const options = {
    version: versionArgs[0].slice("--version=".length),
    directory: resolve(".promotion"),
  };
  const result = await (publish ? publishPromotion(options) : preparePromotion(options));
  const report = {
    package: result.package,
    version: result.version,
    integrity: result.integrity,
    mode: publish ? result.action : "validation-only",
    publicRegistryWriteVerified: result.publicRegistryWriteVerified === true,
    insiderSourceRetained: true,
  };
  await writeFile(join(options.directory, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## CLI public promotion\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n\nValidation does not verify public write authority. Insider source is retained.\n`,
    );
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
