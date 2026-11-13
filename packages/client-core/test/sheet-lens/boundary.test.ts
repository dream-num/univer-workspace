import { readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../../src/sheet-lens/", import.meta.url));

function forbiddenImports(source: string, file: string): string[] {
  const violations: string[] = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const check = (specifier: ts.Node, typeOnly: boolean) => {
    if (!ts.isStringLiteralLike(specifier)) {
      violations.push("non-literal import");
      return;
    }
    const name = specifier.text;
    if (name === "@univerjs/core" && typeOnly) return;
    if (name.startsWith("./") || name.startsWith("../")) {
      const path = relative(root, resolve(dirname(file), name));
      if (path !== ".." && !path.startsWith("../") && !isAbsolute(path)) return;
    }
    violations.push(name);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly =
        clause?.isTypeOnly === true ||
        (clause?.name === undefined &&
          bindings !== undefined &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((binding) => binding.isTypeOnly));
      check(node.moduleSpecifier, typeOnly);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      check(node.moduleSpecifier, node.isTypeOnly);
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument)) check(node.argument.literal, true);
      else violations.push("non-literal import type");
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      if (node.arguments[0]) check(node.arguments[0], false);
      else violations.push("import without a specifier");
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      check(node.moduleReference.expression, node.isTypeOnly);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return violations;
}

test("Lens imports stay inside sheet-lens, except Core types", () => {
  const violations = readdirSync(resolve(root, "lens"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .flatMap((entry) => {
      const file = resolve(entry.parentPath, entry.name);
      return forbiddenImports(readFileSync(file, "utf8"), file).map(
        (specifier) => `${relative(root, file)}: ${specifier}`,
      );
    });
  expect(violations).toEqual([]);
});

test("the boundary distinguishes Core types, runtime imports, and escaping paths", () => {
  const file = resolve(root, "lens/example.ts");
  expect(
    forbiddenImports(
      'import type { ICellData } from "@univerjs/core"; import { type IWorkbookData } from "@univerjs/core"; import "../platform/cell-error.js";',
      file,
    ),
  ).toEqual([]);
  for (const source of [
    'import "node:fs";',
    'import { Univer } from "@univerjs/core";',
    'import "../../errors.js";',
    'export * from "node:fs";',
    'void import("node:fs");',
    "void import(specifier);",
    'type FS = typeof import("node:fs");',
    'import fs = require("node:fs");',
    'require("node:fs");',
  ]) {
    expect(forbiddenImports(source, file), source).not.toEqual([]);
  }
});
