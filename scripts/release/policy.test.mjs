import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReleaseContext,
  npmTagForRelease,
  parseReleaseArguments,
  RELEASE_PACKAGE_NAME,
  RELEASE_REGISTRY,
  validateReleaseManifest,
} from "./policy.mjs";

test("admits exactly 0.4.x latest, insiders, and dev version contracts", () => {
  assert.equal(npmTagForRelease("latest", "0.4.0"), "latest");
  assert.equal(npmTagForRelease("insiders", "0.4.0-insider.20260816-a1b2c3d"), "insiders");
  assert.equal(npmTagForRelease("dev", "0.4.0-dev.feature-a1b2c3d"), "dev");
  assert.throws(() => npmTagForRelease("latest", "0.4.0-alpha.1"), /stable/u);
  assert.throws(() => npmTagForRelease("insiders", "0.4.0-insiders.1"), /-insider/u);
  assert.throws(() => npmTagForRelease("dev", "0.4.0"), /-dev/u);
  assert.throws(() => npmTagForRelease("alpha", "0.4.0-alpha.1"), /Unsupported/u);
  assert.throws(() => npmTagForRelease("insiders", "0.5.0-insider.1"), /0\.4\.x/u);
});

test("parses one explicit release mode", () => {
  assert.deepEqual(
    parseReleaseArguments([
      "--channel=insiders",
      "--version",
      "0.4.0-insider.test",
      "--prepare-only",
    ]),
    {
      channel: "insiders",
      mode: "prepare-only",
      version: "0.4.0-insider.test",
    },
  );
  assert.throws(
    () => parseReleaseArguments(["--channel=dev", "--version=0.4.0-dev.test"]),
    /exactly one/u,
  );
  assert.throws(
    () =>
      parseReleaseArguments([
        "--channel=dev",
        "--version=0.4.0-dev.test",
        "--dry-run",
        "--publish",
      ]),
    /exactly one/u,
  );
});

test("gates latest to a matching stable tag push from GitHub Actions", () => {
  const env = {
    BASE_BRANCH: "main",
    CI: "true",
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF_NAME: "v0.4.0",
    GITHUB_REF_TYPE: "tag",
  };
  assert.doesNotThrow(() => assertReleaseContext("latest", "0.4.0", env));
  assert.throws(
    () => assertReleaseContext("latest", "0.4.1", env),
    /tag v0\.4\.1/u,
  );
  assert.throws(
    () =>
      assertReleaseContext("latest", "0.4.0", {
        ...env,
        GITHUB_ACTIONS: "false",
      }),
    /only in GitHub Actions/u,
  );
});

test("gates insiders to a manual dispatch from the base branch", () => {
  const env = {
    BASE_BRANCH: "main",
    CI: "true",
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF_NAME: "main",
    GITHUB_REF_TYPE: "branch",
  };
  assert.doesNotThrow(() =>
    assertReleaseContext("insiders", "0.4.0-insider.test", env),
  );
  assert.throws(
    () =>
      assertReleaseContext("insiders", "0.4.0-insider.test", {
        ...env,
        GITHUB_REF_NAME: "feature/release",
      }),
    /manually dispatched from main/u,
  );
});

test("allows dev only outside CI", () => {
  assert.doesNotThrow(() =>
    assertReleaseContext("dev", "0.4.0-dev.local", {}),
  );
  assert.throws(
    () => assertReleaseContext("dev", "0.4.0-dev.local", { CI: "true" }),
    /local-only/u,
  );
});

test("validates the reviewed release manifest", () => {
  const manifest = {
    channel: "insiders",
    integrity: "sha512-dGVzdA==",
    npmTag: "insiders",
    package: RELEASE_PACKAGE_NAME,
    registry: RELEASE_REGISTRY,
    schemaVersion: 1,
    sdkVersion: "1.0.0-insiders.sdk",
    sourceSha: "a".repeat(40),
    tarball: "univer-workspace-cli-0.4.0-insider.test.tgz",
    version: "0.4.0-insider.test",
  };
  assert.equal(validateReleaseManifest(manifest), manifest);
  assert.throws(
    () => validateReleaseManifest({ ...manifest, registry: "https://registry.npmjs.org/" }),
    /registry/u,
  );
  assert.throws(
    () => validateReleaseManifest({ ...manifest, tarball: "../release.tgz" }),
    /basename/u,
  );
});
