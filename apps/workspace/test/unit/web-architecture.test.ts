import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("../../web/src/", import.meta.url));
const modeIds = readdirSync(resolve(webRoot, "modes"), { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      ["index.ts", "index.tsx"].some((file) => existsSync(resolve(webRoot, "modes", entry.name, file))),
  )
  .map((entry) => entry.name);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function dependencies(source: ts.SourceFile): string[] {
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      imports.push(node.argument.literal.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) imports.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

const sources = sourceFiles(webRoot).map((path) => ({
  path,
  name: relative(webRoot, path).replaceAll("\\", "/"),
  ast: ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true),
}));

describe("Web 分层边界", () => {
  it("基础层不反向依赖，mode 相互独立，路由只经注册表使用 mode", () => {
    const violations: string[] = [];
    for (const { path, name, ast } of sources) {
      const [layer, mode] = name.split("/");
      for (const specifier of dependencies(ast)) {
        if (!specifier.startsWith(".")) continue;
        const target = relative(webRoot, resolve(dirname(path), specifier))
          .replaceAll("\\", "/")
          .replace(/\.[jt]sx?$/, "");
        const [targetLayer, targetMode] = target.split("/");
        const forbidden =
          (layer === "shared" && ["features", "modes", "routes", "app"].includes(targetLayer!)) ||
          (layer === "features" && ["modes", "routes", "app"].includes(targetLayer!)) ||
          (layer === "modes" && ["routes", "app"].includes(targetLayer!)) ||
          (layer === "modes" &&
            modeIds.includes(mode!) &&
            targetLayer === "modes" &&
            modeIds.includes(targetMode!) &&
            mode !== targetMode) ||
          (layer === "routes" && targetLayer === "modes" && target !== "modes/registry");
        if (forbidden) violations.push(`${name} → ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("Browser 源码不再使用旧 mode 兼容字段", () => {
    const legacy = new Set(["workspace" + "Theme", "setWorkspace" + "Theme"]);
    const violations: string[] = [];
    for (const { name, ast } of sources) {
      const visit = (node: ts.Node) => {
        if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && legacy.has(node.text))
          violations.push(`${name}: ${node.text}`);
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    expect(violations).toEqual([]);
  });
});
