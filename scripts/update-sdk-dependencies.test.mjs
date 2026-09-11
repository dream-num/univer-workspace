import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  alignManifestSdkDependencies,
  discoverWorkspacePackages,
  parseSdkUpdateVersion,
  resolveWorkspaceSdkBaseline,
  stripSdkOverrides,
  validateWorkspaceSdkDependencies,
  validateWorkspaceSdkOverrides,
} from "./update-sdk-dependencies.mjs";

test("exposes the update:univer-sdk command", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(typeof packageJson.scripts?.["update:univer-sdk"], "string");
  assert.equal(packageJson.scripts?.["update:" + "sdk"], undefined);
});

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
      "@univerjs-pro/doc-typst-native-binding": "1.0.0-insiders.20260723-c21613b",
      "@univerjs/icons": "1.38.0",
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
  const { aligned, removed } = alignManifestSdkDependencies(
    manifest,
    "1.0.0-insiders.new",
    new Set(["@univerjs/local"])
  );
  assert.equal(aligned, 7);
  assert.equal(removed, 0);
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
  assert.equal(manifest.dependencies["@univerjs/icons"], "1.38.0");
  assert.equal(manifest.dependencies["@univerjs-pro/cli-assets"], "0.1.0");
  assert.equal(
    manifest.dependencies["@univerjs-pro/doc-typst-native-binding"],
    "1.0.0-insiders.20260723-c21613b"
  );
  assert.equal(manifest.dependencies["@univerjs/local"], "workspace:*");
  assert.equal(manifest.dependencies.react, "^19.0.0");
});

test("removes transitive binding declarations from every dependency field", () => {
  const manifest = {
    name: "consumer",
    dependencies: {
      "@univerjs-pro/engine-formula-rust": "1.0.0-insiders.old",
      "@univerjs-pro/engine-formula-rust-binding": "1.0.0-insiders.native",
      "@univerjs-pro/exchange-node": "1.0.0-insiders.old",
    },
    devDependencies: {
      "@univerjs-pro/exchange-node-binding": "0.1.0",
    },
  };
  const { aligned, removed } = alignManifestSdkDependencies(manifest, "1.0.0-rc.0");
  assert.equal(aligned, 2);
  assert.equal(removed, 2);
  assert.deepEqual(manifest.dependencies, {
    "@univerjs-pro/engine-formula-rust": "1.0.0-rc.0",
    "@univerjs-pro/exchange-node": "1.0.0-rc.0",
  });
  assert.deepEqual(manifest.devDependencies, {});
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

test("rejects a transitive binding declaration in any workspace manifest", () => {
  const packages = [
    { manifest: { name: "consumer", dependencies: { "@univerjs/core": "1.0.0" } } },
  ];
  for (const name of [
    "@univerjs-pro/engine-formula-rust-binding",
    "@univerjs-pro/exchange-node-binding",
  ]) {
    assert.throws(
      () =>
        validateWorkspaceSdkDependencies(
          [...packages, { manifest: { name: "owner", dependencies: { [name]: "0.1.0" } } }],
          "1.0.0"
        ),
      /is a transitive binding package/
    );
  }
});

test("requires independently versioned SDK declarations to stay exact", () => {
  const validate = (name, specifier) =>
    validateWorkspaceSdkDependencies(
      [
        { manifest: { name: "consumer", dependencies: { "@univerjs/core": "1.0.0" } } },
        { manifest: { name: "owner", dependencies: { [name]: specifier } } },
      ],
      "1.0.0"
    );
  for (const [name, specifier] of [
    ["@univerjs/icons", "^1.38.0"],
    ["@univerjs-pro/cli-assets", "latest"],
  ]) {
    assert.throws(() => validate(name, specifier), /must use an exact SemVer/);
  }
  assert.doesNotThrow(() =>
    validate("@univerjs-pro/doc-typst-native-binding", "1.0.0-insiders.20260723-c21613b")
  );
});

test("allows only the Agent development comparison copy for React peer isolation", () => {
  const validate = (consumer, field, specifier) => validateWorkspaceSdkDependencies([
    { manifest: { name: "@univer/unit-comparison-viewer", dependencies: { "@univerjs/core": "1.0.0" } } },
    { manifest: { name: consumer, [field]: { "@univer/unit-comparison-viewer": specifier } } },
  ], "1.0.0");
  assert.doesNotThrow(() => validate("dsh-univer-workspace-plugin", "devDependencies", "file:../unit-comparison-viewer"));
  for (const [consumer, field, specifier] of [
    ["other", "devDependencies", "file:../unit-comparison-viewer"],
    ["dsh-univer-workspace-plugin", "dependencies", "file:../unit-comparison-viewer"],
    ["dsh-univer-workspace-plugin", "devDependencies", "file:../../other"],
  ]) assert.throws(() => validate(consumer, field, specifier), /must use workspace/);

  const align = (consumer, field, specifier) =>
    alignManifestSdkDependencies(
      { name: consumer, [field]: { "@univer/unit-comparison-viewer": specifier } },
      "1.0.0",
      new Set(["@univer/unit-comparison-viewer"])
    );
  assert.doesNotThrow(() =>
    align("dsh-univer-workspace-plugin", "devDependencies", "file:../unit-comparison-viewer")
  );
  assert.throws(
    () => align("dsh-univer-workspace-plugin", "devDependencies", "file:../../other"),
    /must use workspace/
  );
});

test("strips SDK overrides and keeps unrelated overrides", () => {
  const { source, removed } = stripSdkOverrides(
    [
      "packages:",
      "  - apps/*",
      "",
      "overrides:",
      '  "@univer-cli/config": "1.0.0-insiders.old"',
      '  left-pad: "1.3.0"',
      '  "@univerjs-pro/collaboration-service": "1.0.0-insiders.old"',
      "",
      "allowBuilds:",
      "  esbuild: true",
      "",
    ].join("\n")
  );
  assert.deepEqual(removed, [
    "@univer-cli/config",
    "@univerjs-pro/collaboration-service",
  ]);
  assert.equal(
    source,
    [
      "packages:",
      "  - apps/*",
      "",
      "overrides:",
      '  left-pad: "1.3.0"',
      "",
      "allowBuilds:",
      "  esbuild: true",
      "",
    ].join("\n")
  );
});

test("removes the overrides mapping together with its comment when only SDK entries remain", () => {
  const { source, removed } = stripSdkOverrides(
    [
      "minimumReleaseAgeExclude:",
      '  - "@univerjs/*"',
      "",
      "# Temporary Worktree development release.",
      "overrides:",
      '  "@univerjs-pro/collaboration-endpoint": "1.0.0-dev.worktree-removal.20260907"',
      '  "@univerjs-pro/collaboration-comment-endpoint": "1.0.0-dev.worktree-removal.20260907"',
      "",
    ].join("\n")
  );
  assert.deepEqual(removed, [
    "@univerjs-pro/collaboration-endpoint",
    "@univerjs-pro/collaboration-comment-endpoint",
  ]);
  assert.equal(
    source,
    ["minimumReleaseAgeExclude:", '  - "@univerjs/*"', ""].join("\n")
  );
});

test("leaves a workspace configuration without overrides untouched", () => {
  const source = ["packages:", "  - apps/*", ""].join("\n");
  assert.deepEqual(stripSdkOverrides(source), { source, removed: [] });
});

test("accepts dev SDK overrides and rejects release-channel SDK overrides", () => {
  assert.equal(
    validateWorkspaceSdkOverrides(
      [
        "overrides:",
        '  "@univerjs-pro/collaboration-service": "1.0.0-dev.worktree-removal.20260907"',
        '  left-pad: "1.3.0"',
        "",
      ].join("\n")
    ),
    1
  );
  for (const specifier of ["1.0.0-insiders.20260907-70fc579", "1.0.0-rc.0", "1.0.0", "^1.0.0"]) {
    assert.throws(
      () =>
        validateWorkspaceSdkOverrides(
          ["overrides:", `  "@univer-cli/config": "${specifier}"`, ""].join("\n")
        ),
      /must pin a dev SDK version/
    );
  }
});

test("the workspace configuration carries no release-channel SDK override", () => {
  const source = readFileSync(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8");
  assert.doesNotThrow(() => validateWorkspaceSdkOverrides(source));
});
