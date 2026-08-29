/**
 * Bundled skill provider for the capability plugin.
 *
 * Ships the eight Office-shaped SKILL.md entries that route the model to the
 * remote Univer Workspace tools. The provider reads files from the packed
 * bundle; candidates are statically known and never dynamically imported.
 * @module dsh-univer-workspace-plugin/skills
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from "@deepseek-ai/dsh-skill";

const PROVIDER_NAME = "univer-workspace";
const INVOCATION = { modelInvocable: true, userInvocable: true } as const;

const DEFINITIONS = [
  {
    name: "univer",
    description: "Operate remote Univer Workspace Units through the univer_ tools. Use proactively for Space and document discovery, Worktree review, Facade reads, verified Sheet writes, import/export, and explicit status handoff; Doc, Slide, Base, and Board write/Viewer paths remain beta-limited.",
  },
  {
    name: "univer-sheet",
    description: "Read, create, edit, inspect, import, export, and review verified Univer Sheet Units through the Workspace univer_ tools and headless Facade API.",
  },
  {
    name: "univer-doc",
    description: "Discover Univer Doc Units and read their Workspace status/content through univer_open, univer_documents, univer_status, and univer_edit mode=read; Doc Viewer and authoring remain beta-limited.",
  },
  {
    name: "univer-slide",
    description: "Discover Univer Slide Units and read their Workspace status/content through univer_open, univer_documents, univer_status, and univer_edit mode=read; Slide Viewer and authoring remain beta-limited.",
  },
  {
    name: "univer-base",
    description: "Discover Univer Base Units and read their Workspace status/content through univer_open, univer_documents, univer_status, and univer_edit mode=read; Base structured inspection, Viewer, and authoring remain beta-limited.",
  },
  {
    name: "univer-board",
    description: "Discover Univer Board Units and read their Workspace status/content through univer_open, univer_documents, univer_status, and univer_edit mode=read; Board structured inspection, Viewer, and authoring remain beta-limited.",
  },
  {
    name: "univer-embed",
    description: "Inspect Workspace Unit metadata for an embed request; embed authoring and rendering are beta-limited and must not be reported as verified through the current univer_ tools.",
  },
  {
    name: "univer-cross-unit-formula",
    description: "Inspect Workspace Unit metadata for a cross-Unit formula request; cross-Unit formula authoring and calculation are beta-limited and must not be reported as verified through the current univer_ tools.",
  },
] as const;

const CANDIDATES: readonly SkillCandidate[] = DEFINITIONS.map((definition) => {
  const url = new URL(`../skills/${definition.name}/SKILL.md`, import.meta.url);
  return {
    ...definition,
    invocation: INVOCATION,
    provider: PROVIDER_NAME,
    source: "bundled",
    resourceBase: { kind: "directory", path: fileURLToPath(new URL(`../skills/${definition.name}/`, import.meta.url)) },
    rank: BUNDLED_SKILL_RANK,
    locator: url,
  };
});

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve(CANDIDATES),
  async get(candidate): Promise<SkillDefinition> {
    if (!(candidate.locator instanceof URL)) throw new Error("univer-workspace skill locator must be a URL");
    return {
      name: candidate.name,
      description: candidate.description,
      invocation: candidate.invocation,
      provider: candidate.provider,
      source: candidate.source,
      ...candidate.resourceBase === undefined ? {} : { resourceBase: candidate.resourceBase },
      content: stripFrontmatter(await readFile(candidate.locator, "utf8")),
    };
  },
};

export const name = "univer-workspace-skills";

export const inject = ["skills"];

/** Register the bundled skill provider. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider);
}

function stripFrontmatter(value: string): string {
  if (!value.startsWith("---\n")) return value;
  const end = value.indexOf("\n---\n", 4);
  return end === -1 ? value : value.slice(end + 5);
}
