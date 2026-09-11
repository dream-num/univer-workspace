#!/usr/bin/env node
/**
 * Decode javascript-obfuscator string-array wrappers used by published
 * @univerjs-pro packages so the files can be read and patched locally.
 *
 * Writes readable copies to vendor/univer-pro/<pkg>/, then copies them into
 * node_modules with unlink-first so pnpm hardlinks to the store are not mutated.
 *
 * Usage:
 *   node scripts/deobfuscate-univer-pro.mjs
 *   node scripts/deobfuscate-univer-pro.mjs --all
 *   node scripts/deobfuscate-univer-pro.mjs sheets-history-ui edit-history
 *   node scripts/deobfuscate-univer-pro.mjs --no-apply   # vendor only
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRO_ROOT = path.join(ROOT, "apps/workspace/node_modules/@univerjs-pro");
const VENDOR_ROOT = path.join(ROOT, "vendor/univer-pro");

const DEFAULT_PACKAGES = [
  "sheets-history-ui",
  "sheets-history",
  "edit-history",
  "edit-history-ui",
  "docs-history-ui",
  "docs-history",
  "collaboration-history-endpoint",
  "collaboration-history-service",
  "collaboration-history-database-sqlite",
  "collaboration-endpoint",
  "collaboration-client",
  "collaboration"
];

const METHOD_KEYWORDS = new Set(["async", "get", "set", "static"]);
const JS_KEYWORDS = new Set([
  "return",
  "throw",
  "typeof",
  "delete",
  "await",
  "yield",
  "new",
  "if",
  "else",
  "void",
  "case",
  "in",
  "of",
  "instanceof",
  "function",
  "class",
  "const",
  "let",
  "var",
  "import",
  "export",
  "default",
  "from",
  "void",
  "with",
  "switch",
  "while",
  "for",
  "do"
]);

const argv = process.argv.slice(2);
const noApply = argv.includes("--no-apply");
const fixVendor = argv.includes("--fix-vendor");
const all = argv.includes("--all");
const packages = argv
  .filter((a) => !a.startsWith("--"))
  .map((name) => name.replace(/^@univerjs-pro\//, ""));
const selected = packages.length > 0 ? packages : all ? listProPackages() : DEFAULT_PACKAGES;

function listProPackages() {
  return fs
    .readdirSync(PRO_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function walkJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "types" || entry.name === "node_modules" || entry.name === "umd") continue;
      walkJs(full, out);
    } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function copyPackage(pkg) {
  const from = path.join(PRO_ROOT, pkg);
  const to = path.join(VENDOR_ROOT, pkg);
  if (!fs.existsSync(from)) return null;
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (src) => !src.includes(`${path.sep}umd${path.sep}`) && !src.endsWith(`${path.sep}umd`)
  });
  return to;
}

function looksObfuscated(src) {
  return /while\s*\(\s*!!\s*\[\s*\]\s*\)/.test(src) && /function\s+_0x[a-f0-9]+\s*\(/.test(src);
}

function extractRuntime(src) {
  const arrayFns = [
    ...src.matchAll(
      /function\s+(_0x[a-f0-9]+)\s*\(\s*\)\s*\{[\s\S]*?_0x[a-f0-9]+\s*=\s*function\s*\(\s*\)\s*\{\s*return\s+_0x[a-f0-9]+\s*;\s*\}\s*;\s*return\s+_0x[a-f0-9]+\s*\(\s*\)\s*;\s*\}/g
    )
  ];
  const decoders = [
    ...src.matchAll(
      /function\s+(_0x[a-f0-9]+)\s*\(\s*_0x[a-f0-9]+\s*,\s*_0x[a-f0-9]+\s*\)\s*\{[\s\S]*?return\s+_0x[a-f0-9]+\s*;\s*\}/g
    )
  ];
  const rotators = [
    ...src.matchAll(
      /\(\s*function\s*\(\s*_0x[a-f0-9]+\s*,\s*_0x[a-f0-9]+\s*\)\s*\{[\s\S]*?while\s*\(\s*!!\s*\[\s*\]\s*\)[\s\S]*?\}\s*\(\s*_0x[a-f0-9]+\s*,\s*0x[a-f0-9]+\s*\)\s*\)\s*;/g
    )
  ];
  if (arrayFns.length === 0 || decoders.length === 0 || rotators.length === 0) return null;
  return [...arrayFns.map((m) => m[0]), ...decoders.map((m) => m[0]), ...rotators.map((m) => m[0])].join("\n");
}

function loadDecoders(src) {
  const runtime = extractRuntime(src);
  if (!runtime) return null;
  const sandbox = Object.create(null);
  sandbox.console = { log() {}, warn() {}, error() {} };
  try {
    vm.runInNewContext(runtime, sandbox, { timeout: 5_000 });
  } catch {
    return null;
  }
  const decoders = {};
  for (const [name, value] of Object.entries(sandbox)) {
    if (typeof value === "function" && /^_0x[a-f0-9]+$/.test(name) && value.length >= 1) {
      try {
        const sample = value(0);
        if (typeof sample === "string" || sample === undefined) decoders[name] = value;
      } catch {
        // not a decoder
      }
    }
  }
  const aliasRe = /(?:const|let|var)\s+(_0x[a-f0-9]+)\s*=\s*(_0x[a-f0-9]+)\s*;/g;
  let alias;
  while ((alias = aliasRe.exec(src))) {
    if (decoders[alias[2]]) decoders[alias[1]] = decoders[alias[2]];
  }
  return Object.keys(decoders).length ? decoders : null;
}

function decodeCallArgs(raw) {
  const trimmed = raw.trim();
  if (/^0x[a-f0-9]+$/i.test(trimmed)) return Number(trimmed);
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return null;
}

function replaceDecoderCalls(src, decoders) {
  const names = Object.keys(decoders).sort((a, b) => b.length - a.length);
  if (names.length === 0) return src;
  const nameAlt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const callRe = new RegExp(`(?:${nameAlt})\\s*\\(([^)]*)\\)`, "g");
  return src.replace(callRe, (full, args, offset) => {
    const before = src.slice(Math.max(0, offset - 12), offset);
    if (/function\s+$/.test(before)) return full;
    const first = args.split(",")[0];
    const index = decodeCallArgs(first ?? "");
    if (index === null) return full;
    const name = full.slice(0, full.indexOf("(")).trim();
    const decoder = decoders[name];
    if (!decoder) return full;
    try {
      const value = decoder(index);
      if (typeof value !== "string") return full;
      return JSON.stringify(value);
    } catch {
      return full;
    }
  });
}

function cleanupLiterals(src) {
  let out = src;
  out = out.replace(/void 0x0/g, " undefined");
  out = out.replace(/!0x0/g, " true");
  out = out.replace(/!0x1/g, " false");
  out = out.replace(/\b0x([0-9a-fA-F]+)\b/g, (full, hex) => {
    const n = parseInt(hex, 16);
    return Number.isSafeInteger(n) ? String(n) : full;
  });

  out = out.replace(
    /\b(async|get|set|static)\s*\[(["'])([A-Za-z_$][\w$]*)\2\]\s*(?=\()/g,
    "$1 $3"
  );
  out = out.replace(/(^|[{;,}])\s*\[(["'])([A-Za-z_$][\w$]*)\2\]\s*(?=\()/gm, "$1$3");

  // member access, but never after async/get/set/static
  out = out.replace(/([)\].]|[A-Za-z_$][\w$]*)\[(["'])([A-Za-z_$][\w$]*)\2\]/g, (full, obj, _q, ident) => {
    if (METHOD_KEYWORDS.has(obj)) return `${obj} ${ident}`;
    if (JS_KEYWORDS.has(obj)) return `${obj} ["${ident}"]`;
    if (!/^[A-Za-z_$][\w$]*$/.test(obj) && !/^[)\].]$/.test(obj.slice(-1))) {
      return full;
    }
    return `${obj}.${ident}`;
  });
  return unglueKeywords(out);
}

function unglueKeywords(src) {
  return src
    .replace(/\breturn\.([A-Za-z_$][\w$]*)\b/g, 'return ["$1"]')
    .replace(/\bthrow\.([A-Za-z_$][\w$]*)\b/g, "throw $1")
    .replace(/\breturn(true|false|null|undefined|this|new)\b/g, "return $1")
    .replace(/\bthrow(new|Error|TypeError)\b/g, "throw $1")
    .replace(/\btypeof([A-Za-z_$])/g, "typeof $1")
    .replace(/\bdelete([A-Za-z_$])/g, "delete $1")
    .replace(/\bawait([A-Za-z_$])/g, "await $1")
    .replace(/\byield([A-Za-z_$])/g, "yield $1")
    .replace(/\bnew(Map|Set|Error|TypeError|WeakMap|Promise|URL|Int32Array|Uint16Array)\b/g, "new $1")
    .replace(/[ \t]{2,}/g, " ");
}

function stripRuntime(src) {
  let out = src;
  out = out.replace(
    /function\s+_0x[a-f0-9]+\s*\(\s*\)\s*\{[\s\S]*?_0x[a-f0-9]+\s*=\s*function\s*\(\s*\)\s*\{\s*return\s+_0x[a-f0-9]+\s*;\s*\}\s*;\s*return\s+_0x[a-f0-9]+\s*\(\s*\)\s*;\s*\}/g,
    ""
  );
  out = out.replace(
    /function\s+_0x[a-f0-9]+\s*\(\s*_0x[a-f0-9]+\s*,\s*_0x[a-f0-9]+\s*\)\s*\{[\s\S]*?return\s+_0x[a-f0-9]+\s*;\s*\}/g,
    ""
  );
  out = out.replace(
    /\(\s*function\s*\(\s*_0x[a-f0-9]+\s*,\s*_0x[a-f0-9]+\s*\)\s*\{[\s\S]*?while\s*\(\s*!!\s*\[\s*\]\s*\)[\s\S]*?\}\s*\(\s*_0x[a-f0-9]+\s*,\s*0x[a-f0-9]+\s*\)\s*\)\s*;/g,
    ""
  );
  out = out.replace(/(?:const|let|var)\s+_0x[a-f0-9]+\s*=\s*_0x[a-f0-9]+\s*;/g, "");
  return out;
}

function formatFile(filePath) {
  try {
    execFileSync(
      "prettier",
      ["--write", "--parser", "babel", "--with-node-modules", "--ignore-path", "/dev/null", filePath],
      { cwd: ROOT, stdio: "ignore" }
    );
    return true;
  } catch {
    return false;
  }
}

function writeUnlinked(filePath, content) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // new file
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function deobfuscateSource(src) {
  if (!looksObfuscated(src)) return { src, changed: false };
  const decoders = loadDecoders(src);
  if (!decoders) return { src, changed: false };
  let next = replaceDecoderCalls(src, decoders);
  next = stripRuntime(next);
  next = cleanupLiterals(next);
  next = next.replace(/\n{3,}/g, "\n\n");
  return { src: next, changed: next !== src };
}

function processVendorPackage(pkg) {
  const vendorDir = copyPackage(pkg);
  if (!vendorDir) {
    console.warn(`skip missing package @univerjs-pro/${pkg}`);
    return { pkg, files: 0, changed: 0 };
  }
  const files = walkJs(vendorDir);
  let changed = 0;
  for (const file of files) {
    const original = fs.readFileSync(file, "utf8");
    const result = deobfuscateSource(original);
    if (!result.changed) continue;
    writeUnlinked(file, result.src);
    const pretty = formatFile(file);
    changed += 1;
    console.log(`  ${path.relative(VENDOR_ROOT, file)}${pretty ? "" : " (prettier skipped)"}`);
  }
  if (!noApply) applyVendorToNodeModules(pkg);
  return { pkg, files: files.length, changed };
}

function applyVendorToNodeModules(pkg) {
  const vendorDir = path.join(VENDOR_ROOT, pkg);
  const destDir = path.join(PRO_ROOT, pkg);
  if (!fs.existsSync(vendorDir) || !fs.existsSync(destDir)) return;
  for (const file of walkJs(vendorDir)) {
    const rel = path.relative(vendorDir, file);
    const dest = path.join(destDir, rel);
    const content = fs.readFileSync(file);
    writeUnlinked(dest, content);
  }
}

if (fixVendor) {
  let fixed = 0;
  for (const pkg of fs.existsSync(VENDOR_ROOT) ? fs.readdirSync(VENDOR_ROOT) : []) {
    const dir = path.join(VENDOR_ROOT, pkg);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of walkJs(dir)) {
      const original = fs.readFileSync(file, "utf8");
      const next = unglueKeywords(original);
      if (next !== original) {
        writeUnlinked(file, next);
        fixed += 1;
      }
      const pretty = formatFile(file);
      if (next !== original || pretty) {
        console.log(`  ${pretty ? "fmt" : "fix"} ${path.relative(VENDOR_ROOT, file)}`);
      }
    }
    if (!noApply) applyVendorToNodeModules(pkg);
  }
  console.log(`fixed ${fixed} file(s) in vendor/univer-pro`);
  process.exit(0);
}

fs.mkdirSync(VENDOR_ROOT, { recursive: true });
console.log(`Deobfuscating ${selected.length} @univerjs-pro package(s) -> vendor/univer-pro`);
let totalChanged = 0;
for (const pkg of selected) {
  console.log(`@univerjs-pro/${pkg}`);
  const stats = processVendorPackage(pkg);
  totalChanged += stats.changed;
}
console.log(`done: ${totalChanged} file(s) rewritten`);
console.log(`editable copies: ${path.relative(ROOT, VENDOR_ROOT)}`);
if (!noApply) console.log("applied into apps/workspace/node_modules/@univerjs-pro (store hardlinks broken)");
