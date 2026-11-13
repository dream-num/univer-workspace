import { SkillCatalogError, skillEntry } from "@modelcontextprotocol/server/ext/skills";
import {
  WorkspaceBlobFeature,
  WorkspaceSpaceFeature,
  type WorkspaceNode,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import type { WorkspaceSkills } from "./skill-catalog.js";
import type { ToolContext } from "./tools/definition.js";
import { resolveRepo } from "./tools/core/issue-support.js";

const metadataSchema = z.record(z.string(), z.string());

export type SkillSource = "builtin" | "repository" | "user";
export interface SkillEntry {
  name: string;
  description: string;
  source: SkillSource;
  path?: string;
  modelInvocable: boolean;
  userInvocable: boolean;
  argumentHint?: string;
  metadata?: Record<string, string>;
}
export type SkillProblem = "invalid-skill" | "reserved-name" | "shadowed" | "too-large" | "duplicate";
export interface SkillDiagnostic {
  source: "repository" | "user";
  path: string;
  problem: SkillProblem;
  detail?: string;
}
export type RepositorySkills = "loaded" | "not-member" | "no-repository";
export interface SkillCatalog {
  skills: SkillEntry[];
  diagnostics: SkillDiagnostic[];
  repository: RepositorySkills;
}
export type SkillFile =
  | { path: string; kind: "text"; byteSize: number }
  | { path: string; kind: "binary"; byteSize: number; mediaType: string };

type CustomSource = SkillDiagnostic["source"];
interface CustomSkill {
  entry: SkillEntry;
  folder: WorkspaceNode;
  content: string;
}
class InvalidSkillFile extends Error {
  constructor(readonly problem: "invalid-skill" | "too-large") {
    super(problem);
  }
}

async function boundedMap<T, R>(items: readonly T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await read(items[index]!);
    }
  }));
  return results;
}

async function readText(blobs: WorkspaceBlobFeature, node: WorkspaceNode, limit: number) {
  if (node.resource?.kind !== "blob") throw new InvalidSkillFile("invalid-skill");
  if (node.resource.byteSize > limit) throw new InvalidSkillFile("too-large");
  if (node.resource.availability === "quarantined" || !node.resource.capabilities.downloadContent) {
    throw new InvalidSkillFile("invalid-skill");
  }
  const stream = await blobs.downloadStream(node.resource.resourceId);
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let content = "";
    let size = 0;
    for await (const chunk of stream.content) {
      size += chunk.byteLength;
      if (size > limit) throw new InvalidSkillFile("too-large");
      content += decoder.decode(chunk, { stream: true });
    }
    content += decoder.decode();
    if (content.includes("\0")) throw new InvalidSkillFile("invalid-skill");
    return content;
  } catch (error) {
    if (error instanceof TypeError && "code" in error && error.code === "ERR_ENCODING_INVALID_ENCODED_DATA") {
      throw new InvalidSkillFile("invalid-skill");
    }
    throw error;
  } finally {
    await stream.close();
  }
}

async function skillFolders(spaces: WorkspaceSpaceFeature, spaceId: string, source: CustomSource, diagnostics: SkillDiagnostic[], name?: string) {
  let parentNodeId: string | undefined;
  const parts: string[] = [];
  for (const part of [".agents", "skills"]) {
    parts.push(part);
    const children = await spaces.browse({ spaceId, ...(parentNodeId === undefined ? {} : { parentNodeId }) });
    const folders = children.filter((node) => node.name === part && node.resource === null);
    if (folders.length > 1) {
      diagnostics.push({ source, path: parts.join("/"), problem: "duplicate" });
      return [];
    }
    const folder = folders[0];
    if (!folder) return [];
    parentNodeId = folder.nodeId;
  }
  const folders = (await spaces.browse({ spaceId, ...(parentNodeId === undefined ? {} : { parentNodeId }) }))
    .filter((node) => node.resource === null);
  const byName = new Map<string, WorkspaceNode[]>();
  for (const folder of folders) {
    const group = byName.get(folder.name);
    if (group) group.push(folder);
    else byName.set(folder.name, [folder]);
  }
  const names = [...byName.keys()];
  const unique: WorkspaceNode[] = [];
  for (const folderName of name === undefined ? names.slice(0, 100) : names.filter((folderName) => folderName === name)) {
    const group = byName.get(folderName)!;
    if (group.length > 1) diagnostics.push({ source, path: `.agents/skills/${folderName}`, problem: "duplicate" });
    else unique.push(group[0]!);
  }
  return unique;
}

export async function discoverSkills(
  context: ToolContext,
  builtin: WorkspaceSkills,
  repo?: string,
  name?: string,
) {
  const spaces = new WorkspaceSpaceFeature(async () => context.http);
  const blobs = new WorkspaceBlobFeature(async () => context.http);
  const skills = new Map<string, SkillEntry>(builtin.catalog.entries.map(({ frontmatter }) => [
    frontmatter.name,
    { name: frontmatter.name, description: frontmatter.description, source: "builtin", modelInvocable: true, userInvocable: frontmatter["user-invocable"] === true,
      ...(frontmatter.metadata === undefined ? {} : { metadata: metadataSchema.parse(frontmatter.metadata) }) },
  ]));
  const diagnostics: SkillDiagnostic[] = [];
  const spaceId = repo === undefined ? null : await resolveRepo(context, repo);
  const scoped = spaceId === null ? undefined : await spaces.get(spaceId);
  const repository: RepositorySkills = !scoped ? "no-repository"
    : scoped.affiliation === "owner" || scoped.affiliation === "member" ? "loaded" : "not-member";
  const result: { skills: Map<string, SkillEntry>; diagnostics: SkillDiagnostic[]; repository: RepositorySkills; repo: string | null; custom?: CustomSkill } = { skills, diagnostics, repository, repo: spaceId };
  if (name !== undefined && skills.has(name)) return result;
  const personal = (await spaces.list()).find((space) => space.type === "personal" && space.affiliation === "owner");

  async function loadLayer(layerSpaceId: string, source: CustomSource) {
    const folders = await skillFolders(spaces, layerSpaceId, source, diagnostics, name);
    const loaded = await boundedMap(folders, async (folder): Promise<CustomSkill | SkillDiagnostic | undefined> => {
      const path = `.agents/skills/${folder.name}/SKILL.md`;
      const nodes = (await spaces.browse({ spaceId: layerSpaceId, parentNodeId: folder.nodeId }))
        .filter((node) => node.name === "SKILL.md" && node.resource?.kind === "blob");
      if (nodes.length > 1) return { source, path, problem: "duplicate" } satisfies SkillDiagnostic;
      const node = nodes[0];
      if (!node) return undefined;
      if (folder.name === "." || folder.name === ".." || folder.name.includes("/")) {
        return { source, path, problem: "invalid-skill", detail: "The folder name is not a valid skill name." } satisfies SkillDiagnostic;
      }
      try {
        const content = await readText(blobs, node, 64 * 1024);
        const { frontmatter } = await skillEntry(folder.name, { "SKILL.md": new TextEncoder().encode(content) });
        const entry: SkillEntry = {
          name: frontmatter.name, description: frontmatter.description, source, path,
          ...(frontmatter.metadata === undefined ? {} : { metadata: metadataSchema.parse(frontmatter.metadata) }),
          modelInvocable: frontmatter["disable-model-invocation"] !== true,
          userInvocable: frontmatter["user-invocable"] !== false,
          ...(typeof frontmatter["argument-hint"] === "string" ? { argumentHint: frontmatter["argument-hint"] } : {}),
        };
        return { entry, folder, content };
      } catch (error) {
        if (!(error instanceof InvalidSkillFile) && !(error instanceof SkillCatalogError)) throw error;
        return { source, path,
          problem: error instanceof InvalidSkillFile ? error.problem : "invalid-skill",
          ...(error instanceof SkillCatalogError ? { detail: error.problems.map(({ message }) => message).join("; ").slice(0, 300) } : {}),
        } satisfies SkillDiagnostic;
      }
    });
    for (const item of loaded) {
      if (item === undefined) continue;
      if (!("entry" in item)) { diagnostics.push(item); continue; }
      const previous = skills.get(item.entry.name);
      if (previous?.source === "builtin") {
        diagnostics.push({ source, path: item.entry.path!, problem: "reserved-name" });
        continue;
      }
      if (previous?.source === "user" && source === "repository") {
        diagnostics.push({ source: "user", path: previous.path!, problem: "shadowed" });
      }
      skills.set(item.entry.name, item.entry);
      if (name !== undefined) result.custom = item;
    }
  }
  if (name !== undefined && repository === "loaded") {
    await loadLayer(spaceId!, "repository");
    if (result.custom) return result;
  }
  if (personal && personal.id !== spaceId) await loadLayer(personal.id, "user");
  if (name === undefined && repository === "loaded") await loadLayer(spaceId!, "repository");
  return result;
}

export async function customSkillFiles(context: ToolContext, skill: CustomSkill) {
  const spaces = new WorkspaceSpaceFeature(async () => context.http);
  const blobs = new WorkspaceBlobFeature(async () => context.http);
  const nodes = (await spaces.browse({ spaceId: skill.folder.spaceId, parentNodeId: skill.folder.nodeId, recursive: true }))
    .filter((node) => node.resource?.kind === "blob" && node.path !== `${skill.folder.path}/SKILL.md`)
    .slice(0, 100);
  const files = new Map<string, string>([["SKILL.md", skill.content]]);
  const binaryFiles: { path: string; byteSize: number; mediaType: string }[] = [];
  const loaded = await boundedMap(nodes, async (node) => {
    try { return await readText(blobs, node, 256 * 1024); }
    catch (error) {
      if (error instanceof InvalidSkillFile) return undefined;
      throw error;
    }
  });
  const seen = new Set<string>(["SKILL.md"]);
  nodes.forEach((node, index) => {
    const path = node.path.slice(skill.folder.path.length + 1);
    if (seen.has(path)) return;
    seen.add(path);
    const content = loaded[index];
    if (content !== undefined) files.set(path, content);
    else if (node.resource?.kind === "blob") {
      binaryFiles.push({ path, byteSize: node.resource.byteSize, mediaType: node.resource.mediaType });
    }
  });
  return { files, binaryFiles };
}
