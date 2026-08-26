/**
 * Bundled skill provider for the capability plugin.
 *
 * Ships a small set of SKILL.md files that teach the model to operate remote
 * Univer Workspace Units through the univer_ tools. The provider reads the
 * files from disk relative to the bundle; candidates are statically known.
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
    name: "univer-workspace",
    description: "Operate Univer Workspace documents (Units) in the Spaces the current User can access, through the univer_ tools and Worktree review. Use proactively for listing Spaces, listing or creating documents, reading document state, editing in Worktrees, importing and exporting Office files, and reviewing changes before they merge into the official version.",
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
