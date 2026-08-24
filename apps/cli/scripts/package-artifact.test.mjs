import assert from "node:assert/strict";
import test from "node:test";
import {
  createDistributionPackageJson,
  EXTERNAL_RUNTIME_DEPENDENCIES,
  PACKAGE_FILES,
  PUBLISH_REGISTRY,
} from "./package-artifact.mjs";
import { injectNodeCommonjsGlobals } from "./node-commonjs-globals.mjs";

const externalDependencies = Object.fromEntries(
  EXTERNAL_RUNTIME_DEPENDENCIES.map((name) => [name, `1.0.0-${name.length}`]),
);

test("generates a publishable CLI-only manifest", () => {
  const result = createDistributionPackageJson(
    {
      name: "univer-workspace-cli",
      version: "0.0.0",
      private: true,
      license: "Apache-2.0",
      description: "Workspace CLI",
      engines: { node: ">=22.12.0" },
      dependencies: {
        "@univer-cli/daemon": "1.0.0-insiders.test",
        commander: "15.0.0",
      },
    },
    externalDependencies,
    "0.4.0",
  );

  assert.equal(result.private, false);
  assert.deepEqual(result.bin, {
    "univer-workspace-cli": "./bin/univer-workspace-cli.js",
  });
  assert.deepEqual(result.files, PACKAGE_FILES);
  assert.deepEqual(result.dependencies, externalDependencies);
  assert.deepEqual(result.engines, { node: ">=22.12.0" });
  assert.equal(result.description, "Workspace CLI");
  assert.equal(result.license, "Apache-2.0");
  assert.equal(result.devDependencies, undefined);
  assert.equal(result.version, "0.4.0");
  assert.deepEqual(result.publishConfig, { registry: PUBLISH_REGISTRY });
});

test("rejects an undeclared external runtime dependency", () => {
  const dependencies = { ...externalDependencies };
  delete dependencies[EXTERNAL_RUNTIME_DEPENDENCIES[0]];
  assert.throws(
    () =>
      createDistributionPackageJson(
        {
          name: "univer-workspace-cli",
          version: "0.0.0",
          engines: { node: ">=22.12.0" },
        },
        dependencies,
        "0.4.0",
      ),
    /must declare an npm version/u,
  );
});

test("rejects a workspace external runtime dependency", () => {
  assert.throws(
    () =>
      createDistributionPackageJson(
        {
          name: "univer-workspace-cli",
          version: "0.0.0",
          engines: { node: ">=22.12.0" },
        },
        {
          ...externalDependencies,
          [EXTERNAL_RUNTIME_DEPENDENCIES[0]]: "workspace:*",
        },
        "0.4.0",
      ),
    /must declare an npm version/u,
  );
});

test("requires the source manifest to keep the sentinel version", () => {
  assert.throws(
    () =>
      createDistributionPackageJson(
        {
          name: "univer-workspace-cli",
          version: "0.4.0",
          engines: { node: ">=22.12.0" },
        },
        externalDependencies,
        "0.4.0",
      ),
    /Source package version must remain 0\.0\.0/u,
  );
});

test("provides Node globals to bundled CommonJS runtime chunks", () => {
  const transformed = injectNodeCommonjsGlobals(
    'import { helper } from "./helper.js";\nthrow new Error("environment that doesn\'t expose the `require` function");\nconsole.log(__filename, __dirname);',
  );

  assert.match(transformed, /createRequire as __univerCreateRequire/u);
  assert.match(transformed, /const require = __univerCreateRequire\(import\.meta\.url\)/u);
  assert.match(transformed, /const __filename = __univerFileURLToPath\(import\.meta\.url\)/u);
  assert.match(transformed, /const __dirname = __univerPathDirname\(__filename\)/u);
  assert.equal(injectNodeCommonjsGlobals(transformed), undefined);
  assert.equal(injectNodeCommonjsGlobals("export const value = 1;"), undefined);
});
