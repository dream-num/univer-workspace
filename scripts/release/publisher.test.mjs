import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RELEASE_PACKAGE_NAME, RELEASE_REGISTRY } from "./policy.mjs";
import { publishPreparedRelease } from "./publisher.mjs";

test("rejects a tarball changed after review before contacting the registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-cli-publisher-"));
  try {
    const tarball = "univer-workspace-cli-0.0.0-dev.test.tgz";
    const manifestPath = join(root, "release-manifest.json");
    await writeFile(join(root, tarball), "changed tarball", "utf8");
    await writeFile(
      manifestPath,
      JSON.stringify({
        channel: "dev",
        integrity: "sha512-dGVzdA==",
        npmTag: "dev",
        package: RELEASE_PACKAGE_NAME,
        registry: RELEASE_REGISTRY,
        schemaVersion: 1,
        sourceSha: "a".repeat(40),
        tarball,
        version: "0.0.0-dev.test",
      }),
      "utf8",
    );
    await assert.rejects(
      publishPreparedRelease(manifestPath, {}),
      /integrity differs from the reviewed release manifest/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
