import assert from "node:assert/strict";
import test from "node:test";
import {
  alignManifestSdkDependencies,
  discoverWorkspacePackages,
  parseSdkUpdateVersion,
  resolveWorkspaceSdkBaseline,
  validateWorkspaceSdkDependencies,
} from "./update-sdk-dependencies.mjs";

test("requires one exact SDK version", () => {
  assert.equal(
    parseSdkUpdateVersion([
      "--sdk_version",
      "1.0.0-insiders.20260805-b15e7f3",
    ]),
    "1.0.0-insiders.20260805-b15e7f3"
  );
  assert.equal(
    parseSdkUpdateVersion(["--sdk_version=1.0.0"]),
    "1.0.0"
  );
  assert.throws(() => parseSdkUpdateVersion([]), /--sdk_version/);
  assert.throws(() => parseSdkUpdateVersion(["^1.0.0"]), /--sdk_version/);
});

test("aligns SDK dependencies and preserves independent and workspace versions", () => {
  const manifest = {
    name: "consumer",
    dependencies: {
      "@univer-cli/config": "1.0.0-insiders.old",
      "@univerjs/core": "1.0.0-insiders.old",
      "@univerjs-pro/cli-assets": "0.1.0",
      "@univerjs-pro/collaboration-service": "1.0.0-insiders.old",
      "@univerjs-pro/exchange-node-binding": "0.1.0",
      "@univerjs/icons": "1.34.0",
      "@univerjs/local": "workspace:*",
      react: "^19.0.0",
    },
    peerDependencies: {
      "@univerjs-pro/embed": "1.0.0-insiders.old",
    },
    devDependencies: {
      "@univer-cli/univer-render-runtime": "1.0.0-insiders.old",
      "@univerjs/docs": "1.0.0-insiders.old",
    },
    optionalDependencies: {
      "@univerjs/sheets": "1.0.0-insiders.old",
    },
  };
  const changed = alignManifestSdkDependencies(
    manifest,
    "1.0.0-insiders.new",
    new Set(["@univerjs/local"])
  );
  assert.equal(changed, 7);
  assert.equal(manifest.dependencies["@univer-cli/config"], "1.0.0-insiders.new");
  assert.equal(manifest.dependencies["@univerjs/core"], "1.0.0-insiders.new");
  assert.equal(
    manifest.dependencies["@univerjs-pro/collaboration-service"],
    "1.0.0-insiders.new"
  );
  assert.equal(manifest.peerDependencies["@univerjs-pro/embed"], "1.0.0-insiders.new");
  assert.equal(manifest.devDependencies["@univerjs/docs"], "1.0.0-insiders.new");
  assert.equal(
    manifest.devDependencies["@univer-cli/univer-render-runtime"],
    "1.0.0-insiders.new"
  );
  assert.equal(
    manifest.optionalDependencies["@univerjs/sheets"],
    "1.0.0-insiders.new"
  );
  assert.equal(manifest.dependencies["@univerjs/icons"], "1.34.0");
  assert.equal(manifest.dependencies["@univerjs-pro/cli-assets"], "0.1.0");
  assert.equal(manifest.dependencies["@univerjs-pro/exchange-node-binding"], "0.1.0");
  assert.equal(manifest.dependencies["@univerjs/local"], "workspace:*");
  assert.equal(manifest.dependencies.react, "^19.0.0");
});

test("rejects non-exact CLI SDK dependency versions", () => {
  const manifest = {
    name: "consumer",
    dependencies: {
      "@univer-cli/config": "^1.0.0",
    },
  };
  assert.throws(
    () => alignManifestSdkDependencies(manifest, "1.0.0-insiders.new"),
    /must use an exact SemVer/
  );
});

test("every workspace consumer uses one SDK baseline", async () => {
  const packages = await discoverWorkspacePackages();
  const baseline = resolveWorkspaceSdkBaseline(packages);
  assert.ok(validateWorkspaceSdkDependencies(packages, baseline) > 0);
});
