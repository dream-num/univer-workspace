import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RELEASE_PACKAGE_NAME, RELEASE_REGISTRY } from "./policy.mjs";
import { publishPreparedRelease } from "./publisher.mjs";

test("rejects a tarball changed after review before contacting the registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-cli-publisher-"));
  try {
    const tarball = "univer-workspace-cli-0.4.0-dev.test.tgz";
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
        version: "0.4.0-dev.test",
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

test("rejects a reviewed CI artifact from a different workflow source", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-cli-publisher-"));
  try {
    const tarball = "univer-workspace-cli-0.4.0-insider.test.tgz";
    const manifestPath = join(root, "release-manifest.json");
    const tarballContents = "reviewed tarball";
    await writeFile(join(root, tarball), tarballContents, "utf8");
    await writeFile(
      manifestPath,
      JSON.stringify({
        channel: "insiders",
        integrity: `sha512-${createHash("sha512").update(tarballContents).digest("base64")}`,
        npmTag: "insiders",
        package: RELEASE_PACKAGE_NAME,
        registry: RELEASE_REGISTRY,
        schemaVersion: 1,
        sdkVersion: "1.0.0-insiders.sdk",
        sourceSha: "a".repeat(40),
        tarball,
        version: "0.4.0-insider.test",
      }),
      "utf8",
    );
    await assert.rejects(
      publishPreparedRelease(manifestPath, {
        BASE_BRANCH: "main",
        CI: "true",
        GITHUB_ACTIONS: "true",
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_REF_NAME: "main",
        GITHUB_REF_TYPE: "branch",
        GITHUB_SHA: "b".repeat(40),
      }),
      /does not match workflow source/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
