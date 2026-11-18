import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const INSIDER = "https://insider-npm-registry.univer.work/";
export const PUBLIC = "https://registry.npmjs.org/";
const TARBALL = "original.tgz";
const RECORD = "promotion.json";

export function validatePackageName(name) {
  const part = "[a-z0-9][a-z0-9._-]*";
  if (
    typeof name !== "string" ||
    name !== name.trim() ||
    name.length > 214 ||
    !new RegExp(`^(?:@${part}/)?${part}$`, "u").test(name) ||
    ["node_modules", "favicon.ico"].includes(name)
  ) {
    throw new Error("A valid npm package name is required (unscoped or @scope/name).");
  }
  return name;
}

export function validateVersion(version) {
  const number = "(0|[1-9]\\d*)";
  const pre = "(?:0|[1-9]\\d*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)";
  const pattern = `^${number}\\.${number}\\.${number}(?:-${pre}(?:\\.${pre})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`;
  if (
    typeof version !== "string" ||
    version !== version.trim() ||
    !new RegExp(pattern, "u").test(version) ||
    version.length > 256
  )
    throw new Error("An exact SemVer version is required.");
  return version;
}

function validateSelection(packageName, version, latest) {
  validatePackageName(packageName);
  validateVersion(version);
  if (typeof latest !== "boolean") throw new Error("latest must be an explicit boolean.");
  if (latest && /[-+]/u.test(version)) throw new Error("latest requires a stable X.Y.Z version.");
}

export function assertPublishContext(env) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(env.GITHUB_REPOSITORY ?? "") ||
    !env.BASE_BRANCH ||
    env.GITHUB_REF !== `refs/heads/${env.BASE_BRANCH}` ||
    env.GITHUB_WORKFLOW_REF !==
      `${env.GITHUB_REPOSITORY}/.github/workflows/promote-cli-public.yml@refs/heads/${env.BASE_BRANCH}` ||
    !env.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  ) {
    throw new Error(
      "Public publication requires manual dispatch of promote-cli-public.yml on the default branch with OIDC.",
    );
  }
}

function packageUrl(registry, packageName, version) {
  return `${registry}${encodeURIComponent(packageName)}${version === undefined ? "" : `/${encodeURIComponent(version)}`}`;
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

function assertPlan(plan, packageName, version) {
  const selected = plan?.packages?.[0];
  if (
    plan?.status !== "completed" ||
    plan.dryRun !== true ||
    plan.publicRegistryWriteVerified !== false ||
    plan.packageCount !== 1 ||
    plan.packages?.length !== 1 ||
    selected?.name !== packageName ||
    selected.version !== version ||
    !["publish", "reuse"].includes(selected.publicVersion)
  ) {
    throw new Error("Promotion dry-run did not return the exact completed single-package plan.");
  }
}

async function readTarball(path, packageName, version) {
  const { stdout } = await execute("tar", ["-xOzf", path, "package/package.json"], {
    maxBuffer: 1024 * 1024,
  });
  const manifest = JSON.parse(stdout);
  if (manifest.name !== packageName || manifest.version !== version || manifest.private === true) {
    throw new Error("Original tarball manifest does not match the publishable selected version.");
  }
  return manifest;
}

export async function preparePromotion({
  packageName,
  version,
  latest,
  directory,
  env = process.env,
  fetcher = fetch,
}) {
  validateSelection(packageName, version, latest);
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
        body: JSON.stringify({ packages: [{ name: packageName, version }] }),
      },
      fetcher,
    )
  ).json();
  assertPlan(plan, packageName, version);
  const metadata = await (
    await response(packageUrl(INSIDER, packageName, version), {}, fetcher)
  ).json();
  if (metadata.name !== packageName || metadata.version !== version) {
    throw new Error("Insider metadata does not match the selected version.");
  }
  // Promotion dry-run validates the SOURCE tag; its body has no destination-tag option.
  // A latest intent therefore requires the current stable insider latest, not an rc/beta.
  if (latest) {
    const packument = await (await response(packageUrl(INSIDER, packageName), {}, fetcher)).json();
    if (packument.name !== packageName || packument["dist-tags"]?.latest !== version) {
      throw new Error("latest requires the selected version to be the current insider latest.");
    }
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
  await readTarball(tarballPath, packageName, version);
  const record = {
    package: packageName,
    version,
    registry: PUBLIC,
    latest,
    tag: latest ? "latest" : "promoted",
    integrity: hash,
    tarball: TARBALL,
    sourceTarball: tarballUrl.href,
    repository: env.GITHUB_REPOSITORY ?? null,
    workflowRef: env.GITHUB_WORKFLOW_REF ?? null,
    sourceSha: env.GITHUB_SHA ?? null,
    runId: env.GITHUB_RUN_ID ?? null,
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    plan,
  };
  await writeFile(join(directory, RECORD), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

// Explicit flags override publishConfig from the original manifest. No repacking.
export function npmPublishArguments(tarball, tag, registry = PUBLIC) {
  if (!["latest", "promoted"].includes(tag)) throw new Error("Unsupported promotion tag.");
  return [
    "publish",
    tarball,
    `--registry=${registry}`,
    `--tag=${tag}`,
    "--access=public",
    "--ignore-scripts",
    "--provenance=false",
    "--userconfig=/dev/null",
  ];
}

export function npmTagArguments(packageName, version, registry = PUBLIC) {
  validateSelection(packageName, version, true);
  return [
    "dist-tag",
    "add",
    `${packageName}@${version}`,
    "latest",
    `--registry=${registry}`,
    "--userconfig=/dev/null",
  ];
}

async function runPublicNpm(args, env) {
  const directory = await mkdtemp(join(tmpdir(), "insider-public-npm-"));
  try {
    // Only runner/OIDC context reaches npm; no checkout .npmrc or token credentials.
    const cleanEnv = Object.fromEntries(
      Object.entries(env).filter(
        ([key]) => ["PATH", "CI", "SYSTEMROOT"].includes(key) || /^(GITHUB_|ACTIONS_)/u.test(key),
      ),
    );
    Object.assign(cleanEnv, {
      HOME: directory,
      NPM_CONFIG_CACHE: join(directory, "cache"),
      NPM_CONFIG_GLOBALCONFIG: join(directory, "empty-global.npmrc"),
    });
    const { stdout, stderr } = await execute("npm", args, {
      cwd: directory,
      env: cleanEnv,
      timeout: 300_000,
      maxBuffer: 1024 * 1024,
    });
    return { stdout, stderr };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function publishTarball(tarball, env, tag) {
  return runPublicNpm(npmPublishArguments(resolve(tarball), tag), env);
}

export function setLatest(packageName, version, env) {
  return runPublicNpm(npmTagArguments(packageName, version), env);
}

async function publicVersion(packageName, version, fetcher) {
  const result = await fetcher(packageUrl(PUBLIC, packageName, version), {
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
    headers: { "cache-control": "no-cache" },
  });
  if (result.status === 404) return undefined;
  if (!result.ok) throw new Error(`Public version readback failed (${result.status}).`);
  return result.json();
}

async function publicTags(packageName, fetcher) {
  const packument = await publicVersion(packageName, undefined, fetcher);
  if (!packument) return {};
  if (
    packument.name !== packageName ||
    !packument["dist-tags"] ||
    typeof packument["dist-tags"] !== "object" ||
    Array.isArray(packument["dist-tags"])
  ) {
    throw new Error("Public dist-tag readback is invalid.");
  }
  return packument["dist-tags"];
}

function assertPublicVersion(metadata, record) {
  if (
    metadata?.name !== record.package ||
    metadata.version !== record.version ||
    metadata.dist?.integrity !== record.integrity
  ) {
    throw new Error("Public exact-version/integrity readback does not match the original tarball.");
  }
}

export async function publishPromotion({
  packageName,
  version,
  latest,
  directory,
  env = process.env,
  fetcher = fetch,
  publisher = publishTarball,
  tagger = setLatest,
}) {
  validateSelection(packageName, version, latest);
  assertPublishContext(env);
  const record = JSON.parse(await readFile(join(directory, RECORD), "utf8"));
  assertPlan(record.plan, packageName, version);
  if (
    record.package !== packageName ||
    record.version !== version ||
    record.registry !== PUBLIC ||
    record.latest !== latest ||
    record.tag !== (latest ? "latest" : "promoted") ||
    record.repository !== env.GITHUB_REPOSITORY ||
    record.workflowRef !== env.GITHUB_WORKFLOW_REF ||
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
  await readTarball(path, packageName, version);
  const existing = await publicVersion(packageName, version, fetcher);
  const before = await publicTags(packageName, fetcher);
  let action = "reused";
  let tagUpdated = false;
  if (existing) {
    assertPublicVersion(existing, record);
  } else {
    // No blind retry on publish failure: its outcome may be uncertain.
    await publisher(path, env, record.tag);
    action = "published";
  }
  assertPublicVersion(await publicVersion(packageName, version, fetcher), record);
  if (latest && existing && before.latest !== version) {
    await tagger(packageName, version, env);
    tagUpdated = true;
  }
  const after = await publicTags(packageName, fetcher);
  if (latest ? after.latest !== version : after.latest !== before.latest) {
    throw new Error("Public latest readback does not match the requested intent.");
  }
  if (!latest && action === "published" && after.promoted !== version) {
    throw new Error("Public promoted tag readback does not match the published version.");
  }
  if (tagUpdated) assertPublicVersion(await publicVersion(packageName, version, fetcher), record);
  return {
    ...record,
    action,
    tagUpdated,
    latestVerified: latest,
    publicRegistryWriteVerified: action === "published" || tagUpdated,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const options = { directory: resolve(".promotion") };
  const keys = { package: "packageName", version: "version", latest: "latest" };
  let publish = false;
  const seen = new Set();
  for (const arg of args) {
    if (arg === "--publish" && !publish) {
      publish = true;
      continue;
    }
    const match = /^--(package|version|latest)=(.+)$/u.exec(arg);
    if (!match || seen.has(match[1]))
      throw new Error(
        "Expected --package=<name> --version=<exact> --latest=true|false [--publish].",
      );
    seen.add(match[1]);
    options[keys[match[1]]] =
      match[1] === "latest"
        ? match[2] === "true"
          ? true
          : match[2] === "false"
            ? false
            : undefined
        : match[2];
  }
  const result = await (publish ? publishPromotion(options) : preparePromotion(options));
  const report = {
    package: result.package,
    version: result.version,
    integrity: result.integrity,
    latest: result.latest,
    tag: result.tag,
    tagUpdated: result.tagUpdated ?? false,
    latestVerified: result.latestVerified ?? false,
    mode: publish ? result.action : "validation-only",
    publicRegistryWriteVerified: result.publicRegistryWriteVerified === true,
    insiderSourceRetained: true,
  };
  await writeFile(join(options.directory, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Insider package public promotion\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n\nValidation does not verify public write authority. Insider source is retained.\n`,
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
