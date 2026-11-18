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

// Never log request headers, server bodies, arbitrary error messages, or signed URLs.
function transportError(stage, error) {
  const code = error?.cause?.code ?? error?.code;
  const detail = error?.cause?.message === "unexpected redirect"
    ? "unexpected redirect"
    : new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"]).has(code) ? code : "fetch failed";
  return new Error(`${stage}: ${detail}`);
}

async function response(url, options, fetcher, stage = "Registry request") {
  let result;
  try {
    result = await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(120_000) });
  } catch (error) { throw transportError(stage, error); }
  if (!result.ok) {
    await result.body?.cancel();
    throw new Error(`${stage}: HTTP ${result.status}`);
  }
  return result;
}

async function responseJson(result, stage) {
  try { return await result.json(); }
  catch { throw new Error(`${stage}: invalid JSON response`); }
}

// Trust policy only: the download target always comes from the registry's Location.
// Entries are HTTPS origins, not destination templates or assumed storage paths.
// New origins require review; seeing a redirect must not expand the allowlist.
const TRUSTED_TARBALL_ORIGINS = new Set([
  new URL(INSIDER).origin,
  "https://insider-npm.oss-cn-shenzhen.aliyuncs.com",
]);
export async function downloadInsiderTarball(initial, fetcher = fetch) {
  let url = new URL(initial);
  const visited = new Set();
  for (let hop = 0; hop <= 3; hop++) {
    const trusted = TRUSTED_TARBALL_ORIGINS.has(url.origin);
    if (!trusted || url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      throw new Error("Insider tarball: untrusted redirect destination");
    if (visited.has(url.href)) throw new Error("Insider tarball: redirect loop");
    visited.add(url.href);
    let result;
    try {
      // No credentials, cookies, or caller options may cross this boundary.
      result = await fetcher(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(120_000) });
    } catch (error) { throw transportError("Insider tarball", error); }
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      const location = result.headers.get("location");
      await result.body?.cancel();
      if (!location || hop === 3) throw new Error("Insider tarball: redirect limit or missing location");
      try { url = new URL(location, url); }
      catch { throw new Error("Insider tarball: invalid redirect destination"); }
      continue;
    }
    if (!result.ok) {
      await result.body?.cancel();
      throw new Error(`Insider tarball: HTTP ${result.status}`);
    }
    return Buffer.from(await result.arrayBuffer());
  }
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
  const plan = await responseJson(
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
      "Insider Promotion dry-run",
    ),
    "Insider Promotion dry-run",
  );
  assertPlan(plan, packageName, version);
  const packument = await responseJson(
    await response(packageUrl(INSIDER, packageName), {}, fetcher, "Insider packument"),
    "Insider packument",
  );
  const metadata = Object.hasOwn(packument.versions ?? {}, version) ? packument.versions[version] : undefined;
  if (packument.name !== packageName || metadata?.name !== packageName || metadata.version !== version) {
    throw new Error("Insider metadata does not match the selected version.");
  }
  if (latest && packument["dist-tags"]?.latest !== version) {
    throw new Error("latest requires the selected version to be the current insider latest.");
  }
  const tarballUrl = new URL(metadata.dist?.tarball);
  if (tarballUrl.origin !== new URL(INSIDER).origin || tarballUrl.username || tarballUrl.password) {
    throw new Error("The selected tarball must still be hosted by insider-npm.");
  }
  const bytes = await downloadInsiderTarball(tarballUrl, fetcher);
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
  return responseJson(result, "Public readback");
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
  // A failed new attempt must not leave a previous successful submission receipt.
  await rm(join(directory, "submission.json"), { force: true });
  await rm(join(directory, "verification.json"), { force: true });
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
    action = "submitted";
  }
  if (latest && existing && before.latest !== version) {
    await tagger(packageName, version, env);
    tagUpdated = true;
  }
  const submission = { ...record, action, tagUpdated, previousLatest: before.latest ?? null,
    latestVerified: false, publicRegistryWriteVerified: false };
  await writeFile(join(directory, "submission.json"), `${JSON.stringify(submission, null, 2)}\n`);
  return submission;
}

// Separate read-only operation: never invokes a publisher or dist-tag writer.
export async function verifyPromotion({ packageName, version, latest, directory, fetcher = fetch }) {
  await rm(join(directory, "verification.json"), { force: true });
  validateSelection(packageName, version, latest);
  const record = JSON.parse(await readFile(join(directory, "submission.json"), "utf8"));
  if (record.package !== packageName || record.version !== version || record.latest !== latest ||
      record.registry !== PUBLIC || !["submitted", "reused"].includes(record.action) ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(record.integrity ?? ""))
    throw new Error("Verification requires the matching submission record.");
  const metadata = await publicVersion(packageName, version, fetcher);
  if (metadata === undefined) return { ...record, verification: "pending", latestVerified: false, publicRegistryWriteVerified: false };
  assertPublicVersion(metadata, record);
  const after = await publicTags(packageName, fetcher);
  if (latest ? after.latest !== version : (after.latest ?? null) !== record.previousLatest)
    throw new Error("Public latest readback does not match the requested intent.");
  if (!latest && record.action === "submitted" && after.promoted !== version)
    throw new Error("Public promoted tag readback does not match the published version.");
  return { ...record, verification: "verified", latestVerified: latest,
    publicRegistryWriteVerified: record.action === "submitted" || record.tagUpdated === true };

}

async function main() {
  const args = process.argv.slice(2);
  const options = { directory: resolve(".promotion") };
  const keys = { package: "packageName", version: "version", latest: "latest" };
  let publish = false;
  let verify = false;
  const seen = new Set();
  for (const arg of args) {
    if (arg === "--verify" && !verify && !publish) { verify = true; continue; }
    if (arg === "--publish" && !publish && !verify) {
      publish = true;
      continue;
    }
    const match = /^--(package|version|latest)=(.+)$/u.exec(arg);
    if (!match || seen.has(match[1]))
      throw new Error(
        "Expected --package=<name> --version=<exact> --latest=true|false [--publish | --verify].",
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
  const result = await (verify ? verifyPromotion(options) : publish ? publishPromotion(options) : preparePromotion(options));
  const report = {
    package: result.package,
    version: result.version,
    integrity: result.integrity,
    latest: result.latest,
    tag: result.tag,
    tagUpdated: result.tagUpdated ?? false,
    latestVerified: result.latestVerified ?? false,
    mode: verify ? result.verification : publish ? result.action : "validation-only",
    publicRegistryWriteVerified: result.publicRegistryWriteVerified === true,
    insiderSourceRetained: true,
  };
  await writeFile(join(options.directory, verify ? "verification.json" : "result.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Insider package public promotion\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n\nSubmission is not public availability. Verify separately; do not retry publication to resolve pending review. Insider source is retained.\n`,
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
