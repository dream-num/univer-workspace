const semver = require("semver");
const REPOSITORY = "dream-num/univer-workspace";
const TAG_PREFIX = "agent-v";
const DEFAULT_PORT = 3101;

function localOrigin(port = DEFAULT_PORT) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid desktop port");
  return `http://127.0.0.1:${port}`;
}
function isLocalUrl(value, origin) {
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password;
  } catch {
    return false;
  }
}
function isWebUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
function readyUrl(message, origin) {
  if (message?.type !== "uwh-desktop-ready" || !isLocalUrl(message.url, origin)) return null;
  const url = new URL(message.url);
  return url.pathname === "/" && Boolean(url.searchParams.get("token")) ? url.href : null;
}
function validVersion(version) {
  return (
    typeof version === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-alpha\.(0|[1-9]\d*))?$/.test(version) &&
    semver.valid(version) === version
  );
}
function releaseChannel(version) {
  if (!validVersion(version)) throw new Error("Invalid Agent version");
  return semver.prerelease(version) ? "alpha" : "latest";
}
// Stable installations never enter alpha; alpha installations can graduate to stable.
// Ignore unrelated CLI tags and require GitHub's prerelease flag to match the version.
function selectRelease(releases, current) {
  if (!Array.isArray(releases)) throw new Error("Invalid release response");
  const alpha = releaseChannel(current) === "alpha";
  return releases
    .filter((r) => {
      if (r.draft || typeof r.tag_name !== "string" || !r.tag_name.startsWith(TAG_PREFIX))
        return false;
      const version = r.tag_name.slice(TAG_PREFIX.length);
      if (!validVersion(version)) return false;
      const prerelease = releaseChannel(version) === "alpha";
      return (
        Boolean(r.prerelease) === prerelease &&
        (alpha || !prerelease) &&
        semver.gt(version, current)
      );
    })
    .sort((a, b) =>
      semver.rcompare(a.tag_name.slice(TAG_PREFIX.length), b.tag_name.slice(TAG_PREFIX.length)),
    )[0];
}
function releaseFeed(release) {
  const version = release?.tag_name?.slice(TAG_PREFIX.length);
  if (!release?.tag_name?.startsWith(TAG_PREFIX) || !validVersion(version))
    throw new Error("Invalid Agent release");
  return `https://github.com/${REPOSITORY}/releases/download/${TAG_PREFIX}${version}/`;
}
module.exports = {
  validVersion,
  releaseChannel,
  REPOSITORY,
  TAG_PREFIX,
  DEFAULT_PORT,
  localOrigin,
  isLocalUrl,
  isWebUrl,
  readyUrl,
  selectRelease,
  releaseFeed,
};
