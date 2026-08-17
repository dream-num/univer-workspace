export const RELEASE_PACKAGE_NAME = "univer-workspace-cli";
export const RELEASE_REGISTRY = "https://insider-npm-registry.univer.work/";
export const RELEASE_VERSION_LINE = "0.4";
export const SOURCE_PACKAGE_VERSION = "0.0.0";

const EXACT_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const CHANNEL_TO_TAG = new Map([
  ["alpha", "alpha"],
  ["insiders", "insiders"],
  ["dev", "dev"],
]);

export function assertExactSemver(version, label = "Version") {
  if (typeof version !== "string" || !EXACT_SEMVER_PATTERN.test(version)) {
    throw new Error(`${label} must be an exact SemVer version: ${String(version)}`);
  }
  return version;
}

export function npmTagForRelease(channel, version) {
  assertExactSemver(version, "Release version");
  if (!version.startsWith(`${RELEASE_VERSION_LINE}.`)) {
    throw new Error(
      `univer-workspace-cli releases must stay on the ${RELEASE_VERSION_LINE}.x version line.`,
    );
  }
  const npmTag = CHANNEL_TO_TAG.get(channel);
  if (npmTag === undefined) {
    throw new Error(`Unsupported release channel: ${String(channel)}`);
  }
  if (channel === "alpha" && !/^\d+\.\d+\.\d+-alpha\..+$/u.test(version)) {
    throw new Error(`alpha requires 0.4.x-alpha.<suffix>, got ${version}`);
  }
  if (channel === "insiders" && !/^\d+\.\d+\.\d+-insider\..+$/u.test(version)) {
    throw new Error(`insiders requires 0.4.x-insider.<suffix>, got ${version}`);
  }
  if (channel === "dev" && !/^\d+\.\d+\.\d+-dev\..+$/u.test(version)) {
    throw new Error(`dev requires 0.4.x-dev.<suffix>, got ${version}`);
  }
  return npmTag;
}

export function assertReleaseContext(channel, version, env) {
  npmTagForRelease(channel, version);
  const inGitHubActions = env.GITHUB_ACTIONS === "true";
  const inCi = env.CI === "true";
  if (channel === "dev") {
    if (inGitHubActions || inCi) {
      throw new Error("dev releases are local-only and reject CI environments.");
    }
    return;
  }
  if (!inGitHubActions || !inCi) {
    throw new Error(`${channel} releases can run only in GitHub Actions CI.`);
  }
  const baseBranch = env.BASE_BRANCH;
  if (typeof baseBranch !== "string" || baseBranch.length === 0) {
    throw new Error("CI release requires BASE_BRANCH.");
  }
  if (channel === "alpha") {
    if (
      env.GITHUB_EVENT_NAME !== "push" ||
      env.GITHUB_REF_TYPE !== "tag" ||
      env.GITHUB_REF_NAME !== `v${version}`
    ) {
      throw new Error(`alpha must be triggered by pushing git tag v${version}.`);
    }
    return;
  }
  if (
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF_TYPE !== "branch" ||
    env.GITHUB_REF_NAME !== baseBranch
  ) {
    throw new Error(`insiders must be manually dispatched from ${baseBranch}.`);
  }
}

export function parseReleaseArguments(argv) {
  const values = new Map();
  const modes = new Set();
  const args = argv.filter((argument) => argument !== "--");
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--dry-run", "--prepare-only", "--publish"].includes(argument)) {
      modes.add(argument.slice(2));
      continue;
    }
    const match = /^--(channel|version)=(.+)$/u.exec(argument);
    if (match !== null) {
      setOnce(values, match[1], match[2]);
      continue;
    }
    if (argument === "--channel" || argument === "--version") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      setOnce(values, argument.slice(2), value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown release argument: ${argument}`);
  }
  if (!values.has("channel") || !values.has("version")) {
    throw new Error("Release requires --channel and --version.");
  }
  if (modes.size !== 1) {
    throw new Error("Release requires exactly one of --dry-run, --prepare-only, or --publish.");
  }
  return {
    channel: values.get("channel"),
    mode: [...modes][0],
    version: values.get("version"),
  };
}

export function validateReleaseManifest(manifest) {
  if (manifest?.schemaVersion !== 1) {
    throw new Error("Release manifest schemaVersion must be 1.");
  }
  if (manifest.package !== RELEASE_PACKAGE_NAME) {
    throw new Error(`Release manifest package must be ${RELEASE_PACKAGE_NAME}.`);
  }
  const npmTag = npmTagForRelease(manifest.channel, manifest.version);
  if (manifest.npmTag !== npmTag) {
    throw new Error(`Release manifest npmTag must be ${npmTag}.`);
  }
  if (manifest.registry !== RELEASE_REGISTRY) {
    throw new Error(`Release manifest registry must be ${RELEASE_REGISTRY}.`);
  }
  if (
    typeof manifest.tarball !== "string" ||
    manifest.tarball.length === 0 ||
    manifest.tarball.includes("/") ||
    manifest.tarball.includes("\\") ||
    !manifest.tarball.endsWith(".tgz")
  ) {
    throw new Error("Release manifest tarball must be one .tgz basename.");
  }
  if (
    typeof manifest.integrity !== "string" ||
    !/^sha512-[A-Za-z\d+/]+={0,2}$/u.test(manifest.integrity)
  ) {
    throw new Error("Release manifest integrity must be sha512 SRI.");
  }
  if (typeof manifest.sourceSha !== "string" || !/^[0-9a-f]{40}$/u.test(manifest.sourceSha)) {
    throw new Error("Release manifest sourceSha must be a full Git commit SHA.");
  }
  if (manifest.channel === "dev") {
    if (Object.hasOwn(manifest, "sdkVersion")) {
      throw new Error("dev release manifest must not claim an SDK graph check.");
    }
  } else {
    assertExactSemver(manifest.sdkVersion, "Release SDK baseline");
  }
  return manifest;
}

function setOnce(values, name, value) {
  if (values.has(name)) {
    throw new Error(`Release argument --${name} may be provided only once.`);
  }
  values.set(name, value);
}
