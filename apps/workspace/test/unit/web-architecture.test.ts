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

function agentTarget(path: string, specifier: string): string {
  return ((specifier.startsWith(".") || specifier.startsWith("/"))
    ? relative(webRoot, resolve(dirname(path), specifier))
    : specifier.replace(/^@\//, ""))
    .replaceAll("\\", "/").replace(/\.[jt]sx?$/, "");
}

function valueDependencies(source: ts.SourceFile): string[] {
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly = clause?.isTypeOnly || (!clause?.name && bindings && ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 && bindings.elements.every((binding) => binding.isTypeOnly));
      if (!typeOnly) imports.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 && node.exportClause.elements.every((binding) => binding.isTypeOnly));
      if (!typeOnly) imports.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      imports.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" &&
      node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

const agentRuntime = "features/agents/runtime/";
describe("Agents isolation", () => {
  it("only providers may import the provider key store", () => {
    const violations: string[] = [];
    for (const { path, name, ast } of sources) {
      if (name === "features/agents/providers.ts") continue;
      const allDependencies = dependencies(ast);
      const visit = (node: ts.Node) => {
        if (ts.isExternalModuleReference(node) && node.expression && ts.isStringLiteral(node.expression)) allDependencies.push(node.expression.text);
        ts.forEachChild(node, visit);
      };
      visit(ast);
      for (const specifier of allDependencies) {
        if (agentTarget(path, specifier) === "features/agents/provider-keys") violations.push(`${name} → ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("only the Agents entry point is statically reachable and it loads implementation dynamically", () => {
    const violations: string[] = [];
    const agentRoot = "features/agents/";
    for (const { path, name, ast } of sources) {
      const imports = valueDependencies(ast);
      if (name === `${agentRoot}index.ts`) {
        for (const specifier of imports) violations.push(`${name} → ${specifier}`);
      } else if (!name.startsWith(agentRoot)) {
        for (const specifier of imports) {
          const target = agentTarget(path, specifier);
          if (target.startsWith(agentRoot) && target !== `${agentRoot}index`) violations.push(`${name} → ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("AI SDK value imports stay inside the lazy runtime", () => {
    const violations: string[] = [];
    for (const { name, ast } of sources) {
      if (name.startsWith(agentRuntime)) continue;
      for (const specifier of valueDependencies(ast)) {
        if (specifier === "ai" || specifier.startsWith("@ai-sdk/")) violations.push(`${name} → ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("only dynamic imports and type imports cross into the runtime", () => {
    const violations: string[] = [];
    for (const { path, name, ast } of sources) {
      if (name.startsWith(agentRuntime)) continue;
      for (const specifier of valueDependencies(ast)) {
        const target = agentTarget(path, specifier);
        if (target === agentRuntime.slice(0, -1) || target.startsWith(agentRuntime)) violations.push(`${name} → ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("agent code receives browser capabilities through dependencies", () => {
    const globals = new Set(["window", "document", "localStorage", "sessionStorage", "indexedDB", "navigator", "globalThis"]);
    const violations: string[] = [];
    for (const { name, ast } of sources) {
      if (!name.startsWith("features/agents/") || name.endsWith(".test.ts") || name === "features/agents/index.ts") continue;
      const visit = (node: ts.Node) => {
        const parent = node.parent;
        const property = parent && (ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent) ||
          ts.isPropertyAccessExpression(parent)) && parent.name === node ||
          (parent && ts.isBindingElement(parent) && parent.propertyName === node);
        if (ts.isIdentifier(node) && globals.has(node.text) && !property) violations.push(`${name}: ${node.text}`);
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    expect(violations).toEqual([]);
  });
});
