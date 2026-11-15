import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

export function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

interface Dependency {
  readonly specifier: string;
  readonly kind: "type" | "static" | "dynamic";
}

export function importReferences(source: ts.SourceFile): Dependency[] {
  const imports: Dependency[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly = clause?.isTypeOnly || (!clause?.name && bindings && ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 && bindings.elements.every((binding) => binding.isTypeOnly));
      imports.push({ specifier: node.moduleSpecifier.text, kind: typeOnly ? "type" : "static" });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 && node.exportClause.elements.every((binding) => binding.isTypeOnly));
      imports.push({ specifier: node.moduleSpecifier.text, kind: typeOnly ? "type" : "static" });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      imports.push({ specifier: node.moduleReference.expression.text, kind: node.isTypeOnly ? "type" : "static" });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      imports.push({ specifier: node.argument.literal.text, kind: "type" });
    } else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        imports.push({ specifier: node.arguments[0].text, kind: "dynamic" });
      } else if (ts.isIdentifier(node.expression) && ["require", "moduleRequire"].includes(node.expression.text)) {
        imports.push({ specifier: node.arguments[0].text, kind: "static" });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

export function dependencies(source: ts.SourceFile): string[] {
  return importReferences(source).map(({ specifier }) => specifier);
}

export function staticValueDependencies(source: ts.SourceFile): string[] {
  return importReferences(source).filter(({ kind }) => kind === "static").map(({ specifier }) => specifier);
}
