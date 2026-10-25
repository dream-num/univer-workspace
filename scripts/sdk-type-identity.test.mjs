import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));

test("keeps SDK service identifiers compatible in both React host graphs", () => {
  const configPath = resolve(root, "packages/dsh-univer-workspace-plugin/tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(configPath, ".."));
  assert.deepEqual(parsed.errors, []);
  const fixtures = new Map([
    [
      resolve(root, "packages/unit-comparison-viewer/sdk-type-identity.fixture.ts").replaceAll(
        "\\",
        "/",
      ),
      `import type { Univer } from "@univerjs/core";
import { IRenderManagerService, UniverRenderEnginePlugin } from "@univerjs/engine-render";
export function read(univer: Univer) {
  univer.registerPlugin(UniverRenderEnginePlugin);
  return univer.__getInjector().get(IRenderManagerService);
}`,
    ],
    [
      resolve(root, "packages/dsh-univer-workspace-plugin/sdk-type-identity.fixture.ts").replaceAll(
        "\\",
        "/",
      ),
      `import type { Univer } from "@univerjs/core";
import { setDependencies } from "@univerjs/core";
import { IReferencedUnitManagerService, UniverEmbedPlugin } from "@univerjs-pro/embed";
import { ISocketService } from "@univerjs/network";
class ReferenceConsumer {}
setDependencies(ReferenceConsumer, [IReferencedUnitManagerService]);
export function read(univer: Univer) {
  univer.registerPlugin(UniverEmbedPlugin);
  return [
    univer.__getInjector().get(IReferencedUnitManagerService),
    univer.__getInjector().get(ISocketService),
  ];
}`,
    ],
  ]);
  for (const rootNames of [[...fixtures.keys()], [...fixtures.keys()].reverse()]) {
    const host = ts.createCompilerHost(parsed.options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (file, languageVersion, ...args) => {
      const source = fixtures.get(file);
      return source === undefined
        ? getSourceFile(file, languageVersion, ...args)
        : ts.createSourceFile(file, source, languageVersion, true);
    };
    const program = ts.createProgram({ rootNames, options: parsed.options, host });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(
      diagnostics.length,
      0,
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => root,
        getCanonicalFileName: (file) => file,
        getNewLine: () => "\n",
      }),
    );
  }
});
