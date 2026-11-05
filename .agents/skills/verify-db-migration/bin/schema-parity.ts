// Usage (from apps/workspace):
//   node --import tsx ../../.agents/skills/verify-db-migration/bin/schema-parity.ts \
//     [--dist] [--base <ref>] [--ref <deployed-ref>]...
// Exit 0 when every historical schema migrates to exactly the fresh-install schema.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const SCHEMA = "apps/workspace/server/src/db/schema.sql";
const { values: options } = parseArgs({
  options: {
    dist: { type: "boolean", default: false },
    base: { type: "string", default: "origin/main" },
    ref: { type: "string", multiple: true, default: [] },
  },
});
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (...argv: string[]) => execFileSync("git", argv, { cwd: root, encoding: "utf8" });
if (git("rev-parse", "--is-shallow-repository").trim() !== "false") {
  throw new Error("Shallow clone: run `git fetch --unshallow --tags` so every deployed schema is visible.");
}

process.env.LOG_LEVEL ??= "warn";
const build = options.dist ? "apps/workspace/dist/server/db" : "apps/workspace/server/src/db";
const extension = options.dist ? "js" : "ts";
const load = async <T>(path: string) => (await import(pathToFileURL(resolve(root, build, path)).href)) as T;
const { prepareCurrentDatabase } = await load<{ prepareCurrentDatabase(filename: string): unknown }>(
  `migrations/prepare-current-database.${extension}`,
);
const { openWorkspaceDatabase } = await load<{
  openWorkspaceDatabase(filename: string): { connection: DatabaseSync; close(): void };
}>(`initialize.${extension}`);

const versionOf = (sql: string) => Number(/PRAGMA\s+user_version\s*=\s*(\d+)/i.exec(sql)?.[1]);

/** Case, whitespace and comments are insignificant outside quotes; quoted text is kept verbatim. */
function normalize(sql: string | null): string {
  return (sql ?? "")
    .split(/('(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\])/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .replace(/\s*([(),=<>!+*/-])\s*/g, "$1"),
    )
    .join("")
    .trim()
    .replace(/^create (unique |temp |temporary )?(table|index|trigger|view) if not exists /, "create $1$2 ");
}

/** Top-level comma-separated items of a CREATE TABLE body plus its trailing options. */
function tableItems(sql: string): { items: string[]; options: string } {
  const text = normalize(sql);
  const open = text.indexOf("(");
  const items: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let index = open; index < text.length; index++) {
    const char = text[index]!;
    if (char === "'" || char === '"' || char === "`" || char === "[") {
      const close = char === "[" ? "]" : char;
      index = text.indexOf(close, index + 1);
      while (close !== "]" && text[index + 1] === close) index = text.indexOf(close, index + 2);
      continue;
    }
    if (char === "(") depth++;
    if (char === ")" && --depth === 0) {
      items.push(text.slice(start, index));
      return { items, options: text.slice(index + 1).trim() };
    }
    if (char === "," && depth === 1) {
      items.push(text.slice(start, index));
      start = index + 1;
    }
  }
  throw new Error(`Unbalanced CREATE TABLE: ${sql}`);
}

/**
 * The comparable shape of a database. Column definitions and table constraints are
 * compared as unordered DDL items, so `ADD COLUMN` appending after constraints is not
 * a difference, while collation, defaults, CHECKs, generated expressions and foreign
 * keys are. Column order comes from table_xinfo.
 */
function shape(database: DatabaseSync): Map<string, string> {
  const result = new Map<string, string>();
  const all = (sql: string) => database.prepare(sql).all() as Array<Record<string, unknown>>;
  result.set("pragma user_version", String(database.prepare("PRAGMA user_version").get()?.user_version));
  for (const { name, type, wr, strict } of all("PRAGMA main.table_list")) {
    if (type === "table" && !String(name).startsWith("sqlite_")) {
      result.set(`table ${name} options`, JSON.stringify({ withoutRowid: wr, strict }));
    }
  }
  for (const object of all(
    "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
  )) {
    const key = `${object.type} ${object.name}`;
    if (object.type !== "table") {
      result.set(key, normalize(object.sql as string));
      continue;
    }
    const table = String(object.name);
    const { items, options: tail } = tableItems(object.sql as string);
    result.set(`${key} column order`, JSON.stringify(all(`PRAGMA table_xinfo("${table}")`).map(({ name }) => name)));
    result.set(`${key} definitions`, JSON.stringify([...items].sort()));
    result.set(`${key} table options`, tail);
    result.set(`${key} indexes`, JSON.stringify(all(`PRAGMA index_list("${table}")`).map((index) => JSON.stringify([
      index.origin === "c" ? index.name : index.origin,
      index.unique,
      index.partial,
      all(`PRAGMA index_xinfo("${String(index.name)}")`)
        .filter(({ key: isKey }) => isKey)
        .map(({ name, desc, coll }) => [name, desc, coll]),
    ])).sort()));
  }
  return result;
}

const differences = (expected: Map<string, string>, actual: Map<string, string>) =>
  [...new Set([...expected.keys(), ...actual.keys()])]
    .filter((key) => expected.get(key) !== actual.get(key))
    .map((key) => `  ${key}\n    fresh:    ${expected.get(key) ?? "<absent>"}\n    migrated: ${actual.get(key) ?? "<absent>"}`);

const directory = mkdtempSync(join(tmpdir(), "verify-db-migration-"));
let failures = 0;
try {
  const fresh = new DatabaseSync(join(directory, "fresh.sqlite"));
  const currentSql = readFileSync(join(root, SCHEMA), "utf8");
  fresh.exec(currentSql);
  const expected = shape(fresh);
  fresh.close();
  console.log(`target: working-tree schema.sql V${versionOf(currentSql)} via ${options.dist ? "dist" : "source"}`);

  const revisions = [
    ...git("log", "--first-parent", "--format=%H", options.base, "--", SCHEMA).split("\n"),
    ...git("tag", "--list", "v*").split("\n"),
    ...options.ref,
  ].filter(Boolean);
  const blobs = new Map<string, string[]>();
  for (const revision of revisions) {
    let blob: string;
    try {
      blob = git("rev-parse", "--verify", "--quiet", `${revision}:${SCHEMA}`).trim();
    } catch {
      console.log(`skip ${revision}: no ${SCHEMA}`);
      continue;
    }
    blobs.set(blob, [...(blobs.get(blob) ?? []), /^[0-9a-f]{40}$/.test(revision) ? revision.slice(0, 9) : revision]);
  }
  if (blobs.size === 0) throw new Error(`No historical ${SCHEMA} found from ${options.base} or v* tags.`);

  for (const [blob, names] of blobs) {
    const sql = git("cat-file", "blob", blob);
    const label = `V${versionOf(sql)} ${blob.slice(0, 9)} (${names.join(", ")})`;
    const filename = join(directory, `${blob}.sqlite`);
    const seed = new DatabaseSync(filename);
    seed.exec(sql);
    seed.close();
    const problems: string[] = [];
    try {
      // Compare before startup re-runs schema.sql: its IF NOT EXISTS statements would
      // otherwise create, on an old database, whatever the migration forgot.
      prepareCurrentDatabase(filename);
      const migrated = new DatabaseSync(filename, { readOnly: true });
      problems.push(...differences(expected, shape(migrated)));
      migrated.close();
      openWorkspaceDatabase(filename).close();
      openWorkspaceDatabase(filename).close();
      const backups = readdirSync(directory).filter((name) => name.startsWith(`${blob}.sqlite.v`));
      if (backups.length > (versionOf(sql) === versionOf(currentSql) ? 0 : 1)) {
        problems.push(`  restart created another backup: ${backups.join(", ")}`);
      }
    } catch (error) {
      problems.push(`  startup threw ${(error as Error).message}`);
    }
    if (problems.length === 0) {
      console.log(`ok   ${label}`);
      continue;
    }
    failures++;
    console.log(`FAIL ${label}\n${problems.join("\n")}`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
