import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PNPM_BUILTINS = new Set(
  "install i add remove update deploy exec dlx run link unlink list ls why store outdated".split(
    " ",
  ),
);
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const scriptsOf = (file) => (existsSync(file) ? (readJson(file).scripts ?? {}) : {});

function workspacePackages(root) {
  const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const block = yaml.match(/^packages:\n((?:[ \t]+.*\n|[ \t]*#.*\n)*)/m)?.[1] ?? "";
  const globs = [...block.matchAll(/^\s+-\s+["']?([^"'\s#]+)/gm)].map((m) => m[1]);
  const exclude = globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1));
  return globs
    .filter((g) => !g.startsWith("!"))
    .flatMap((g) => globSync(g, { cwd: root, exclude }))
    .map((dir) => join(root, dir, "package.json"))
    .filter(existsSync);
}

function pnpmScripts(code) {
  const refs = [];
  const words = code.split(/\s+/);
  for (let i = words.indexOf("pnpm"); i !== -1; i = words.indexOf("pnpm", i + 1)) {
    let [first, ...rest] = words.slice(i + 1);
    let pkg;
    if (first === "--filter" || first === "-F") [pkg, first, ...rest] = rest;
    const name = first === "run" ? rest[0] : first;
    if (!name || /^-|[<>$]/.test(name) || (!pkg && PNPM_BUILTINS.has(name))) continue;
    refs.push(pkg ? `${pkg} ${name}` : name);
  }
  return refs;
}

function nearestManifest(dir, root) {
  for (let current = dir; ; current = dirname(current)) {
    if (existsSync(join(current, "package.json"))) return join(current, "package.json");
    if (current === root || current === dirname(current)) return null;
  }
}

const KINDS = [
  {
    kind: "link",
    extract: ({ text }) =>
      [...text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
        .map((m) => m[1].split("#")[0])
        .filter((target) => target && !/^(https?|mailto):/.test(target)),
    exists: (ref, { fileDir }) => existsSync(join(fileDir, ref)),
  },
  {
    kind: "path",
    extract: ({ code }) =>
      code
        .filter((token) => token.includes("/") && !/[\s<>*{$]|:\/\/|^(@|~|-|http)/.test(token))
        .map((token) => token.replace(/:\d+(:\d+)?$/, "").replace(/\/+$/, "")),
    exists: (ref, { root, fileDir }) => {
      const first = ref.split("/")[0];
      const bases = [fileDir, root].filter((base) => first && existsSync(join(base, first)));
      return bases.length === 0 || bases.some((base) => existsSync(join(base, ref)));
    },
  },
  {
    kind: "pnpm-script",
    extract: ({ code }) => code.flatMap(pnpmScripts),
    exists: (ref, { root }) => {
      const [pkg, name] = ref.includes(" ") ? ref.split(" ") : [null, ref];
      const manifest = pkg
        ? workspacePackages(root).find((file) => readJson(file).name === pkg)
        : join(root, "package.json");
      return Boolean(manifest) && name in scriptsOf(manifest);
    },
  },
  {
    kind: "npm-script",
    extract: ({ code }) =>
      code.flatMap((span) => [...span.matchAll(/\bnpm run ([^\s<>$]+)/g)].map((m) => m[1])),
    exists: (ref, { root, fileDir }) => {
      const manifest = nearestManifest(fileDir, root);
      return Boolean(manifest) && ref in scriptsOf(manifest);
    },
  },
];

function parseLines(source) {
  let fenced = false;
  let open = false;
  return source.split("\n").map((text) => {
    if (/^\s*(```|~~~)/.test(text)) {
      fenced = !fenced;
      return { text, code: [] };
    }
    if (fenced) return { text, code: [text] };
    if (!text.trim()) open = false;
    // An inline code span may wrap onto the next line of the same paragraph.
    const parts = text.split("`");
    const code = parts.filter((_, index) => index % 2 === (open ? 0 : 1));
    if (parts.length % 2 === 0) open = !open;
    return { text, code };
  });
}

export function checkAgentsMd(root) {
  const files = execFileSync("git", ["ls-files", "--", "AGENTS.md", "**/AGENTS.md"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  const problems = [];
  for (const file of files) {
    const ctx = { root, fileDir: dirname(join(root, file)) };
    parseLines(readFileSync(join(root, file), "utf8")).forEach((line, index) => {
      for (const { kind, extract, exists } of KINDS)
        for (const ref of extract(line))
          if (!exists(ref, ctx)) problems.push(`${file}:${index + 1}: ${kind} ${ref} not found`);
    });
  }
  return problems;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const problems = checkAgentsMd(root);
  for (const problem of problems) console.log(problem);
  process.exitCode = problems.length ? 1 : 0;
}
