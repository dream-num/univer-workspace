import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
import { importReferences, sourceFiles } from "../support/source-dependencies.js";

const root = fileURLToPath(new URL("../../server/src/", import.meta.url));
const sources = sourceFiles(root).filter((path) => !path.endsWith(".test.ts"));
const adapters = ["db/sqlite/", "db/postgres/"];
const factory = "db/open-product-database";
const commands = ["main", "db/ban-agent"];

function sourceName(path: string): string {
  return relative(root, path).replaceAll("\\", "/").replace(/\.[jt]sx?$/, "");
}

function readSource(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

it("keeps product database adapters private and selects them at the factory", () => {
  const violations: string[] = [];
  for (const path of sources) {
    const name = sourceName(path);
    const ast = readSource(path);
    for (const { specifier, kind } of importReferences(ast)) {
      const target = specifier.startsWith(".") ? sourceName(resolve(dirname(path), specifier)) : specifier;
      const adapter = adapters.find((prefix) => target.startsWith(prefix));
      if (target === "node:sqlite") {
        if (!name.startsWith("db/sqlite/") && !name.startsWith("integrations/univer/collaboration-database/sqlite/migrations/")) {
          violations.push(`${name} → ${target}`);
        }
      } else if ((target === "pg" || target.startsWith("pg/")) && !name.startsWith("db/postgres/") && !name.startsWith("integrations/univer/collaboration-database/postgres/")) {
        violations.push(`${name} → ${target}`);
      } else if (adapter && !name.startsWith(adapter)) {
        if (name !== factory || target !== `${adapter}open`) {
          violations.push(`${name} → ${target}`);
        }
      } else if (!name.startsWith("db/") && target.startsWith("db/") && target !== "db/index") {
        violations.push(`${name} → ${target}`);
      } else if (target === "db/index" && kind !== "type" && !commands.includes(name)) {
        // Services and the Express application may depend on types, never the runtime factory.
        violations.push(`${name} → ${target} (runtime import)`);
      }
    }
  }
  expect(violations).toEqual([]);
});

it("exposes product repository I/O through promises", () => {
  const violations: string[] = [];
  for (const path of sources.filter((file) => file.endsWith(".repository.ts") && sourceName(file).startsWith("modules/"))) {
    for (const declaration of readSource(path).statements) {
      if (!ts.isInterfaceDeclaration(declaration) || !declaration.name.text.endsWith("Repository")) continue;
      for (const method of declaration.members) {
        if (!ts.isMethodSignature(method) || !method.type ||
            !ts.isTypeReferenceNode(method.type) || method.type.typeName.getText() !== "Promise") {
          violations.push(`${declaration.name.text}.${method.name?.getText()}`);
        }
      }
    }
  }
  expect(violations).toEqual([]);
});

it("exports only the database factory and type-only contracts from the public entry point", () => {
  const runtimeExports: string[] = [];
  for (const statement of readSource(resolve(root, "db/index.ts")).statements) {
    expect(ts.isExportDeclaration(statement)).toBe(true);
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
    const clause = statement.exportClause;
    expect(clause && ts.isNamedExports(clause)).toBe(true);
    if (clause && ts.isNamedExports(clause)) {
      runtimeExports.push(...clause.elements.filter((entry) => !entry.isTypeOnly).map((entry) => entry.name.text));
    }
  }
  expect(runtimeExports).toEqual(["openProductDatabase"]);
});
