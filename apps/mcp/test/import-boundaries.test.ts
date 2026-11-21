import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

// `executor-fc` is the same execution surface as `executor`; only the gateway-side affinity
// modules are meant to be imported elsewhere.
const isExecutorPath = (value: string) =>
  value.startsWith("executor/") || value.startsWith("executor-fc/");
const isFcExecutorOnly = (value: string) =>
  value === "executor-fc/executor.ts" || value === "executor-fc/main.ts";

it("keeps native execution, RPC framing and credential access behind their owners", async () => {
  const root = resolve("src");
  const failures: string[] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const file = join(entry.parentPath, entry.name);
    const path = relative(root, file);
    const source = await readFile(file, "utf8");
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const check = (specifier: string, typeOnly: boolean) => {
      const resolved = specifier.startsWith(".")
        ? relative(root, resolve(dirname(file), specifier))
        : specifier;
      if (/^(gateway|shared)\//.test(path)) {
        if (
          (specifier.startsWith("@univerjs/univer-workspace-client-core") &&
            specifier !== "@univerjs/univer-workspace-client-core/product") ||
          specifier.startsWith("@univerjs-pro/") ||
          resolved.startsWith("executor/") ||
          isFcExecutorOnly(resolved) ||
          (!typeOnly &&
            specifier.startsWith("@univer-cli/") &&
            !["@univer-cli/api-reference", "@univer-cli/resource-library"].includes(specifier))
        )
          failures.push(`${path} imports runtime ${specifier}`);
      }
      if (isExecutorPath(path) && resolved.startsWith("gateway/"))
        failures.push(`${path} imports gateway`);
      if (
        path.startsWith("renderer/") &&
        (resolved.startsWith("gateway/") ||
          (isExecutorPath(resolved) && resolved !== "executor/license.js") ||
          specifier.startsWith("@univerjs/univer-workspace-client-core") ||
          specifier.startsWith("@univerjs-pro/"))
      )
        failures.push(`${path} imports ${specifier}`);
      // Only the FC executor assembly may load the resident executor; the affinity modules are
      // imported by the gateway and must stay free of headless runtime packages.
      if (
        path.startsWith("executor-fc/") &&
        !isFcExecutorOnly(path) &&
        resolved.startsWith("executor/")
      )
        failures.push(`${path} imports executor runtime`);
      if (/apps\/cli|packages\/client-core\/(src|dist)/.test(specifier))
        failures.push(`${path} imports application internals`);
      if (
        resolved === "shared/frame.js" &&
        ![
          "gateway/executor/client.ts",
          "executor/renderer-client.ts",
          "executor/server.ts",
          "renderer/server.ts",
        ].includes(path)
      )
        failures.push(`${path} imports frame codec`);
      if (resolved === "gateway/executor/client.js" && path !== "gateway/tools/executor-tool.ts")
        failures.push(`${path} imports executor client`);
    };
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
        check(node.moduleSpecifier.text, node.importClause?.isTypeOnly ?? false);
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        check(node.moduleSpecifier.text, node.isTypeOnly);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        check(node.arguments[0].text, false);
      ts.forEachChild(node, visit);
    };
    visit(ast);
    if (
      path.startsWith("gateway/tools/") &&
      path !== "gateway/tools/executor-tool.ts" &&
      /context\.executor/.test(source)
    )
      failures.push(`${path} opens the executor link`);
    if (path.startsWith("renderer/") && /WorkspaceHttp|WORKSPACE_|grant|session/i.test(source))
      failures.push(`${path} touches Workspace HTTP or credentials`);
    if (isExecutorPath(path) && path !== "executor/credentials.ts" && /grant\.session/.test(source))
      failures.push(`${path} reads grant secrets`);
  }
  expect(failures).toEqual([]);
});
