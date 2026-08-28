import assert from "node:assert/strict";
import test from "node:test";
import {
  createDistributionPackageJson,
  EXTERNAL_RUNTIME_DEPENDENCIES,
  PACKAGE_FILES,
  PUBLISH_REGISTRY,
  resolveRenderRuntimeDependencies,
  resolveTypstNativeBindingVersion,
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

test("resolves the Typst native binding from the Client Core-owned facade", () => {
  assert.equal(
    resolveTypstNativeBindingVersion(
      { dependencies: { "@univer-cli/doc-typst-facade": "1.0.0-beta.2" } },
      {
        version: "1.0.0-beta.2",
        dependencies: { "@univerjs-pro/doc-typst-native-binding": "0.1.0" },
      },
    ),
    "0.1.0",
  );
});

test("rejects a Typst facade not owned by Client Core", () => {
  assert.throws(
    () => resolveTypstNativeBindingVersion({ dependencies: {} }, {}),
    /@univer-cli\/doc-typst-facade must be declared by its owning runtime package/u,
  );
  assert.throws(
    () =>
      resolveTypstNativeBindingVersion(
        { dependencies: { "@univer-cli/doc-typst-facade": "workspace:*" } },
        {},
      ),
    /@univer-cli\/doc-typst-facade must be declared by its owning runtime package/u,
  );
});

test("rejects a resolved Typst facade that differs from the Client Core declaration", () => {
  assert.throws(
    () =>
      resolveTypstNativeBindingVersion(
        { dependencies: { "@univer-cli/doc-typst-facade": "1.0.0-beta.2" } },
        { version: "1.0.0-beta.3" },
      ),
    /does not match declared 1\.0\.0-beta\.2/u,
  );
});

test("requires the Typst facade to own an npm-versioned native binding", () => {
  for (const dependencies of [
    {},
    { "@univerjs-pro/doc-typst-native-binding": "workspace:*" },
  ]) {
    assert.throws(
      () =>
        resolveTypstNativeBindingVersion(
          { dependencies: { "@univer-cli/doc-typst-facade": "1.0.0-beta.2" } },
          { version: "1.0.0-beta.2", dependencies },
        ),
      /@univerjs-pro\/doc-typst-native-binding must be declared by its owning runtime package/u,
    );
  }
});

test("resolves browser dependencies from the Client Core-owned render runtime", () => {
  assert.deepEqual(
    resolveRenderRuntimeDependencies(
      { dependencies: { "@univer-cli/univer-render-runtime": "1.0.0-beta.2" } },
      {
        version: "1.0.0-beta.2",
        dependencies: { "@puppeteer/browsers": "2.0.0", "puppeteer-core": "3.0.0" },
      },
    ),
    { "@puppeteer/browsers": "2.0.0", "puppeteer-core": "3.0.0" },
  );
});

test("rejects a render runtime not owned by Client Core", () => {
  for (const dependencies of [{}, { "@univer-cli/univer-render-runtime": "workspace:*" }]) {
    assert.throws(
      () => resolveRenderRuntimeDependencies({ dependencies }, {}),
      /@univer-cli\/univer-render-runtime must be declared by its owning runtime package/u,
    );
  }
});

test("rejects a resolved render runtime that differs from the Client Core declaration", () => {
  assert.throws(
    () =>
      resolveRenderRuntimeDependencies(
        { dependencies: { "@univer-cli/univer-render-runtime": "1.0.0-beta.2" } },
        { version: "1.0.0-beta.3" },
      ),
    /does not match declared 1\.0\.0-beta\.2/u,
  );
});

test("requires the render runtime to own npm-versioned browser dependencies", () => {
  for (const dependencies of [
    { "puppeteer-core": "3.0.0" },
    { "@puppeteer/browsers": "2.0.0", "puppeteer-core": "workspace:*" },
  ]) {
    assert.throws(
      () =>
        resolveRenderRuntimeDependencies(
          { dependencies: { "@univer-cli/univer-render-runtime": "1.0.0-beta.2" } },
          { version: "1.0.0-beta.2", dependencies },
        ),
      /must be declared by its owning runtime package/u,
    );
  }
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
