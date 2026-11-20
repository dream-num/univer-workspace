import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { assertExactSemver, RELEASE_PACKAGE_NAME } from "./policy.mjs";

const REGISTRY = "https://registry.npmjs.org/";
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_TARBALL_BYTES = 256 * 1024 * 1024;

function checkVersion(version) {
  try {
    if (typeof version !== "string" || version.length > 128 || /\s/u.test(version)) {
      throw new Error();
    }
    assertExactSemver(version);
    if (version.split("-").slice(1).join("-").split(".").some((part) => /^0\d+$/u.test(part))) {
      throw new Error();
    }
  } catch {
    throw new Error("Set an exact npm version, such as 0.7.1, not a range or dist-tag.");
  }
}

function checkIntegrity(integrity) {
  if (typeof integrity !== "string" || !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(integrity)) {
    throw new Error("Supply an expected sha512-... from the reviewed promotion record.");
  }
  const bytes = Buffer.from(integrity.slice(7), "base64");
  if (bytes.length !== 64 || `sha512-${bytes.toString("base64")}` !== integrity) {
    throw new Error("The expected SHA-512 digest is not canonical base64.");
  }
}

async function get(url, fetcher, accept) {
  try {
    return await fetcher(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
      headers: { accept, "cache-control": "no-cache" },
    });
  } catch {
    throw new Error("Could not read the public npm registry; no package was verified.");
  }
}

async function readBody(response, limit, consume) {
  if (!response.body) throw new Error("The registry returned no response body.");
  let total = 0;
  for await (const bytes of response.body) {
    total += bytes.length;
    if (total > limit) throw new Error("The registry response exceeds the verification size limit.");
    consume(bytes);
  }
}

export async function verifyPublicCli({ version, expectedIntegrity, fetcher = fetch }) {
  const packageName = RELEASE_PACKAGE_NAME;
  checkVersion(version);
  checkIntegrity(expectedIntegrity);

  const metadataResponse = await get(`${REGISTRY}${packageName}/${version}`, fetcher, "application/json");
  if (metadataResponse.status === 404) throw new Error("This exact version is not visible on public npm.");
  if (metadataResponse.status !== 200) throw new Error(`Public npm metadata HTTP ${metadataResponse.status}.`);

  const chunks = [];
  await readBody(metadataResponse, MAX_METADATA_BYTES, (bytes) => chunks.push(bytes));
  let metadata;
  try {
    metadata = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Public npm returned invalid package metadata.");
  }
  if (metadata?.name !== packageName || metadata.version !== version) {
    throw new Error("Public npm metadata returned a different package name or version.");
  }
  if (metadata.dist?.integrity !== expectedIntegrity) {
    throw new Error("Public npm metadata integrity does not match the promotion record.");
  }

  // Fetch only this exact npm registry tarball, never a metadata-controlled destination.
  const tarballUrl = `${REGISTRY}${packageName}/-/${packageName}-${version}.tgz`;
  if (metadata.dist.tarball !== tarballUrl) {
    throw new Error("Public npm metadata does not point at the exact trusted registry tarball.");
  }
  const tarball = await get(tarballUrl, fetcher, "application/octet-stream");
  if (tarball.status !== 200) throw new Error(`Public npm tarball HTTP ${tarball.status}.`);
  const hash = createHash("sha512");
  await readBody(tarball, MAX_TARBALL_BYTES, (bytes) => hash.update(bytes));
  const actualIntegrity = `sha512-${hash.digest("base64")}`;
  if (actualIntegrity !== expectedIntegrity) {
    throw new Error("Downloaded public npm tarball bytes do not match the promotion record.");
  }
  return { packageName, version, integrity: actualIntegrity, tarballUrl };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyPublicCli({
      version: process.env.VERIFY_VERSION,
      expectedIntegrity: process.env.VERIFY_INTEGRITY,
    });
    console.log(`Verified on public npm: ${result.packageName}@${result.version}\n${result.integrity}`);
  } catch (error) {
    console.error(`Verification failed: ${error.message.replace(/[\r\n]+/gu, " ")}`);
    process.exitCode = 1;
  }
}
