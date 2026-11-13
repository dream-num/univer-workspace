import { skillEntry } from "@modelcontextprotocol/server/ext/skills";
import { z } from "zod";
import { ApplicationError } from "../../middleware/errors.js";
import { invalidSource } from "./sources.parse.js";
import type { ResolvedSource } from "./sources.types.js";
import { decodeSkillText, safeSkillPath, type ScanFile } from "./scan.js";

export async function importSkillFiles(options: {
  files: ScanFile[];
  source: ResolvedSource;
  label: string;
  skill: string;
  name: string;
  importedAt: number;
  overrides: { path: string; text: string | null }[];
}): Promise<ScanFile[]> {
  const files = new Map(options.files.map((f) => [f.path, f]));
  const overridden = new Set<string>();
  for (const override of options.overrides) {
    if (!safeSkillPath(override.path) || overridden.has(override.path))
      throw invalidSource("Overrides must have unique safe relative paths.");
    overridden.add(override.path);
    if (override.text === null) files.delete(override.path);
    else {
      const bytes = Buffer.from(override.text, "utf8");
      if (decodeSkillText(bytes) === null)
        throw invalidSource("Text overrides must be UTF-8 without NUL bytes.");
      files.set(override.path, { path: override.path, bytes });
    }
  }
  const manifest = files.get("SKILL.md");
  if (manifest && manifest.bytes.byteLength > 64 * 1024)
    throw new ApplicationError("PAYLOAD_TOO_LARGE", 413, "SKILL.md exceeds 64 KiB.");
  const text = manifest && decodeSkillText(manifest.bytes);
  if (text === undefined || text === null)
    throw invalidSource("Imported Skill needs a text SKILL.md.");
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(text);
  if (!match) throw invalidSource("Imported Skill needs valid frontmatter.");
  let metadata: Record<string, string>;
  try {
    const entry = await skillEntry(options.name, { "SKILL.md": manifest!.bytes });
    metadata = z.record(z.string(), z.string()).parse(entry.frontmatter.metadata ?? {});
  } catch {
    throw invalidSource(
      "Imported SKILL.md must have valid Skill frontmatter matching the draft name. Use an override to adapt it.",
    );
  }
  const source = options.source;
  const record: Record<string, string> = {
    source:
      source.kind === "git"
        ? `github.com/${source.owner}/${source.repo}${options.skill === "." ? "" : `/${options.skill}`}`
        : source.kind === "clawhub"
          ? `clawhub.ai/${source.owner}/skills/${source.slug}`
          : options.label,
    ...(source.kind === "git" ? { "source-commit": source.commit } : {}),
    ...(source.kind === "clawhub" ? { "source-version": source.version } : {}),
    "source-hub": source.kind === "git" ? source.hub : source.kind,
    "imported-at": new Date(options.importedAt).toISOString().slice(0, 10),
  };
  delete metadata["source-commit"];
  delete metadata["source-version"];
  const field = `metadata: ${JSON.stringify({ ...metadata, ...record })}`;
  const frontmatter = match[2]!;
  const existing =
    /^(?:metadata|"metadata"|'metadata'):[^\r\n]*(?:(?:\r?\n)(?:[ \t]+[^\r\n]*|#[^\r\n]*|(?=\r?\n|$)))*/m;
  const updated = existing.test(frontmatter)
    ? frontmatter.replace(
        existing,
        (previous) => field + (/(?:\r?\n(?:[ \t]*|#[^\r\n]*))*$/.exec(previous)?.[0] ?? ""),
      )
    : `${frontmatter}${match[1]!.includes("\r") ? "\r\n" : "\n"}${field}`;
  const result =
    text.slice(0, match[1]!.length) + updated + text.slice(match[1]!.length + frontmatter.length);
  try {
    await skillEntry(options.name, { "SKILL.md": result });
  } catch {
    throw invalidSource(
      "Cannot stamp provenance into this frontmatter. Use a SKILL.md override with block-style YAML.",
    );
  }
  files.set("SKILL.md", { path: "SKILL.md", bytes: Buffer.from(result, "utf8") });
  return [...files.values()];
}
