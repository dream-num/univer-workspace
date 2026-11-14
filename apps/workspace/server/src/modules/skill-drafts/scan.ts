import { posix } from "node:path";
import { skillEntry } from "@modelcontextprotocol/server/ext/skills";
import type { ReviewFinding, ScanFinding, VerifiedReviewFinding } from "./drafts.types.js";

export const RESERVED_SKILL_NAMES = [
  "core",
  "base",
  "blob",
  "board",
  "cross-unit-formula",
  "doc",
  "embed",
  "html-view",
  "html-view-creator",
  "sheet",
  "slide",
  "skill-creator",
] as const;
export interface ScanFile {
  path: string;
  bytes: Uint8Array;
  symlink?: boolean;
}
export interface ScanContext {
  nameConflict?: boolean;
  hubVerdict?: { suspicious: boolean; message: string };
}
export function decodeSkillText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
export function safeSkillPath(path: string): boolean {
  return (
    path.length <= 1024 &&
    path
      .split("/")
      .every((part) => part.length > 0 && part.length <= 255 && part !== "." && part !== "..") &&
    !/[\\\x00-\x1f\x7f]/.test(path) &&
    !/^[A-Za-z]:/.test(path)
  );
}
function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

export async function scanSkill(
  name: string,
  files: readonly ScanFile[],
  context: ScanContext = {},
): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  const add = (
    rule: ScanFinding["rule"],
    severity: ScanFinding["severity"],
    path: string,
    message: string,
    line: number | null = null,
  ) => {
    findings.push({ rule, severity, path, line, message });
  };
  if (RESERVED_SKILL_NAMES.some((reserved) => reserved === name))
    add("reserved-name", "block", "SKILL.md", "This name belongs to a built-in Skill.");
  const total = files.reduce((n, file) => n + file.bytes.byteLength, 0);
  if (files.length > 100 || total > 20 * 1024 * 1024)
    add("size-limit", "block", "SKILL.md", "A Skill is limited to 100 files and 20 MiB.");
  const paths = new Set(files.map((file) => file.path));
  const manifest = files.find((file) => file.path === "SKILL.md");
  let frontmatter: Record<string, unknown> = {};
  try {
    if (!manifest || decodeSkillText(manifest.bytes) === null)
      throw new Error("Missing text manifest");
    ({ frontmatter } = await skillEntry(name, { "SKILL.md": manifest.bytes }));
  } catch {
    add(
      "frontmatter-invalid",
      "block",
      "SKILL.md",
      "SKILL.md must have valid Skill frontmatter matching its folder name.",
    );
  }
  for (const file of files) {
    const { path, bytes } = file;
    const text = decodeSkillText(bytes);
    const extension = posix.extname(path).toLowerCase();
    if (
      !safeSkillPath(path) ||
      file.symlink ||
      files.filter((other) => other.path === path).length > 1 ||
      path
        .split("/")
        .slice(0, -1)
        .some((_, i, parts) => paths.has(parts.slice(0, i + 1).join("/")))
    ) {
      add(
        "unsafe-path",
        "block",
        path,
        "Paths must be unique relative files without traversal, symlinks or file/folder collisions.",
      );
    }
    if (
      (path === "SKILL.md" && bytes.byteLength > 64 * 1024) ||
      (text === null && bytes.byteLength > 10 * 1024 * 1024)
    )
      add("size-limit", "block", path, "SKILL.md is limited to 64 KiB and binary files to 10 MiB.");
    if (path !== "SKILL.md" && text !== null && bytes.byteLength > 256 * 1024)
      add("text-too-large", "warn", path, "The model cannot read text files larger than 256 KiB.");
    const facadeScript = [".js", ".ts"].includes(extension) && text?.includes("univerAPI");
    if (facadeScript) add("facade-script", "info", path, "Facade code can be passed to execute.");
    else if (
      path.startsWith("scripts/") ||
      /\.(?:py|sh|bash|zsh|fish|ps1|bat|cmd|rb|pl|js|mjs|cjs|ts|tsx|jsx|lua|r)$/i.test(path) ||
      text?.startsWith("#!")
    )
      add("script-file", "warn", path, "Workspace does not execute Skill scripts in a shell.");
    const header = Buffer.from(bytes.subarray(0, 4)).toString("hex");
    if (
      /\.(?:exe|dll|so|dylib|wasm|jar|whl|zip|tar|gz|tgz|bz2|xz|7z|rar)$/i.test(path) ||
      [
        "7f454c46",
        "feedface",
        "feedfacf",
        "cefaedfe",
        "cffaedfe",
        "cafebabe",
        "bebafeca",
        "cafebabf",
        "bfbafeca",
      ].includes(header) ||
      header.startsWith("4d5a")
    )
      add(
        "executable-binary",
        "warn",
        path,
        "Executable or archived content cannot run in Workspace.",
      );
    if (/\.(?:xlsx?|xlsm|xltx|xltm|docx?|docm|dotx|pptx?|pptm|potx|ods|odt|odp)$/i.test(path))
      add(
        "office-asset",
        "warn",
        path,
        "Office templates cannot currently be imported from Skill assets as Units.",
      );
    if (/\.(?:png|jpe?g|gif|webp|svg|ico|bmp|avif|woff2?|ttf|otf|eot)$/i.test(path))
      add("media-asset", "info", path, "The model cannot inspect image or font content.");
    if (text !== null) {
      const hidden = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]|<!--/.exec(text);
      if (hidden)
        add(
          "hidden-text",
          "warn",
          path,
          "Hidden text or directional controls need review.",
          lineAt(text, hidden.index),
        );
    }
  }
  if (manifest) {
    const text = decodeSkillText(manifest.bytes);
    if (text !== null) {
      for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)|`([^`\n]+)`/g)) {
        let reference = match[1] ?? match[2]!;
        if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(reference)) continue;
        reference = reference.split(/[?#]/)[0]!;
        try {
          reference = decodeURIComponent(reference);
        } catch {
          continue;
        }
        if (
          reference.endsWith("/") ||
          /[<>]/.test(reference) ||
          reference.startsWith("/") ||
          !/^[^\s<>/]+\.[a-z0-9_-]+$/i.test(posix.basename(reference))
        )
          continue;
        const normalized = posix.normalize(reference);
        if (paths.has(normalized)) continue;
        add(
          "missing-reference",
          "warn",
          "SKILL.md",
          "A relative file reference is missing from the Skill.",
          lineAt(text, match.index),
        );
      }
    }
  }
  for (const field of ["allowed-tools", "context", "model", "hooks", "paths", "agent"]) {
    if (Object.hasOwn(frontmatter, field))
      add("ignored-field", "info", "SKILL.md", `Workspace ignores the ${field} field.`);
  }
  if (context.nameConflict)
    add(
      "name-conflict",
      "warn",
      "SKILL.md",
      "A same-named Skill already exists or a repository Skill shadows a personal Skill.",
    );
  if (context.hubVerdict)
    add(
      "hub-verdict",
      context.hubVerdict.suspicious ? "warn" : "info",
      "SKILL.md",
      context.hubVerdict.message,
    );
  return findings;
}

export function verifyReview(
  files: readonly ScanFile[],
  submitted: readonly ReviewFinding[],
): { review: VerifiedReviewFinding[]; unverifiedReviewCount: number } {
  const review: VerifiedReviewFinding[] = [];
  let unverifiedReviewCount = 0;
  for (const finding of submitted) {
    if (!finding.quote || finding.quote.length > 200)
      throw new Error("Review quotes must contain 1 to 200 characters.");
    const file = files.find((file) => file.path === finding.path);
    const text = file ? decodeSkillText(file.bytes) : null;
    const offset = text?.indexOf(finding.quote) ?? -1;
    if (text === null || offset < 0) unverifiedReviewCount++;
    else review.push({ ...finding, line: lineAt(text, offset), severity: "warn" });
  }
  return { review, unverifiedReviewCount };
}
export function compatibility(
  scan: readonly ScanFinding[],
  review: readonly VerifiedReviewFinding[],
): "ready" | "degraded" | "blocked" {
  return scan.some((finding) => finding.severity === "block")
    ? "blocked"
    : scan.some((finding) => finding.severity === "warn") || review.length > 0
      ? "degraded"
      : "ready";
}
