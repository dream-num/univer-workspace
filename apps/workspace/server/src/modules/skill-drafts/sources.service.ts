import { createHash } from "node:crypto";
import { posix } from "node:path";
import { skillEntry } from "@modelcontextprotocol/server/ext/skills";
import { z } from "zod";
import type { BlobStore } from "../../integrations/blob/blob-store.js";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver, BlobResourceAccess } from "../access/index.js";
import { NodesRepository } from "../nodes/nodes.repository.js";
import {
  decodeSkillText,
  safeSkillPath,
  scanSkill,
  type ScanContext,
  type ScanFile,
} from "./scan.js";
import { createSourceFetch, type SourceFetch } from "./sources.fetch.js";
import { invalidSource, parseSkillSource } from "./sources.parse.js";
import { sourceReadSchema, type ResolvedSource, type SourceInput } from "./sources.types.js";
import { ARCHIVE_LIMITS, extractSkillZip } from "./sources.zip.js";

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const encodedPath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const notFound = () => new ApplicationError("NOT_FOUND", 404, "Skill source or file not found.");
const conflict = () =>
  new ApplicationError(
    "CONFLICT",
    409,
    "Space source changed since resolution. Read the source again.",
  );
const limit = () =>
  new ApplicationError("PAYLOAD_TOO_LARGE", 413, "Skill source exceeds its file or byte limits.");
const commitSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) });
const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z
    .array(
      z.object({
        path: z.string(),
        type: z.enum(["blob", "tree", "commit"]),
        mode: z.string(),
        size: z.number().int().nonnegative().optional(),
      }),
    )
    .max(100_000),
});
const moderationSchema = z.object({
  isSuspicious: z.boolean().optional(),
  isMalwareBlocked: z.boolean().optional(),
  hasWarnings: z.boolean().optional(),
});
const scannerSchema = z.object({
  status: z.string().optional(),
  hasWarnings: z.boolean().optional(),
});
const securitySchema = scannerSchema.extend({
  scanners: z.record(z.string(), scannerSchema.nullable()).optional(),
});
const hubSkillSchema = z.object({
  skill: z.object({ slug: z.string() }),
  owner: z.object({ handle: z.string() }),
  latestVersion: z.object({ version: z.string() }).nullable(),
  moderation: moderationSchema.nullish(),
});
const versionSchema = z.object({
  version: z.object({
    version: z.string(),
    files: z
      .array(
        z.object({
          path: z.string(),
          size: z.number().int().nonnegative(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .max(100),
    security: securitySchema.nullish(),
  }),
});
interface SourceFile {
  path: string;
  size: number;
  symlink?: boolean;
  read: () => Promise<Uint8Array>;
}
interface LoadedSource {
  source: ResolvedSource;
  files: SourceFile[];
  label: string;
  context: ScanContext;
  check?: () => void;
}
export interface SourceCandidate {
  name: string;
  description: string;
  path: string;
  fileCount: number;
  problems: string[];
}
export type SkillSourcesModule = ReturnType<typeof createSkillSourcesModule>;

function parseResponse<T>(schema: z.ZodType<T>, bytes: Uint8Array): T {
  try {
    return schema.parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
  } catch {
    throw new ApplicationError(
      "SKILL_SOURCE_UNAVAILABLE",
      502,
      "Hub returned an invalid source response.",
    );
  }
}
function validateFiles(files: readonly SourceFile[]) {
  const paths = new Set<string>();
  for (const file of files) {
    if (!safeSkillPath(file.path) || file.symlink || paths.has(file.path))
      throw invalidSource("Source contains unsafe paths, duplicates or symlinks.");
    paths.add(file.path);
  }
  for (const path of paths) {
    const parts = path.split("/");
    if (parts.slice(0, -1).some((_, index) => paths.has(parts.slice(0, index + 1).join("/"))))
      throw invalidSource("Source contains a file/folder collision.");
  }
}
export function checkSkillLimits(files: readonly ScanFile[]) {
  if (
    files.length > 100 ||
    files.reduce((n, f) => n + f.bytes.byteLength, 0) > 20 * 1024 * 1024 ||
    files.some(
      (f) =>
        (f.path === "SKILL.md" && f.bytes.byteLength > 64 * 1024) ||
        (decodeSkillText(f.bytes) === null && f.bytes.byteLength > 10 * 1024 * 1024),
    )
  )
    throw limit();
}
function skillFiles(files: SourceFile[], directory: string): SourceFile[] {
  const prefix = directory === "." ? "" : `${directory}/`;
  return files
    .filter((f) => f.path.startsWith(prefix))
    .map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
}
async function candidate(files: SourceFile[], manifest: SourceFile): Promise<SourceCandidate> {
  const path = posix.dirname(manifest.path);
  const ownFiles = skillFiles(files, path);
  const fallback = posix.basename(path);
  const problems: string[] = [];
  let name = fallback === "." ? "skill" : fallback;
  let description = "";
  if (manifest.size > 64 * 1024) problems.push("SKILL.md exceeds 64 KiB.");
  else {
    const bytes = await manifest.read();
    const text = decodeSkillText(bytes);
    const declared = text?.match(
      /^(?:name|"name"|'name'):\s*["']?([a-z0-9]+(?:-[a-z0-9]+)*)["']?\s*$/m,
    )?.[1];
    if (declared) name = declared;
    try {
      const entry = await skillEntry(name, { "SKILL.md": bytes });
      description = entry.frontmatter.description;
    } catch {
      problems.push("SKILL.md has invalid Skill frontmatter.");
    }
  }
  if (ownFiles.length > 100 || ownFiles.reduce((n, f) => n + f.size, 0) > 20 * 1024 * 1024)
    problems.push("Skill exceeds 100 files or 20 MiB.");
  return { name, description, path, fileCount: ownFiles.length, problems };
}

export function createSkillSourcesModule(options: {
  access: AccessResolver;
  nodes: NodesRepository;
  store: BlobStore;
  githubToken?: string;
  fetch?: SourceFetch;
}) {
  const read = createSourceFetch(options);
  const json = async <T>(url: string, schema: z.ZodType<T>) =>
    parseResponse(schema, await read(url, 8 * 1024 * 1024));
  async function gitSource(
    input: Extract<SourceInput | ResolvedSource, { kind: "git" }>,
  ): Promise<LoadedSource> {
    const api = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;
    const commit =
      "commit" in input
        ? input.commit
        : (await json(`${api}/commits/${encodeURIComponent(input.ref)}`, commitSchema)).sha;
    const tree = await json(`${api}/git/trees/${commit}?recursive=1`, treeSchema);
    if (tree.truncated)
      throw new ApplicationError(
        "SKILL_SOURCE_TRUNCATED",
        422,
        "GitHub tree is truncated. Upload a smaller Skill zip to Space.",
      );
    let path = input.path;
    if ("skill" in input && input.skill) {
      const matches = tree.tree.filter(
        (f) =>
          posix.basename(f.path) === "SKILL.md" &&
          posix.basename(posix.dirname(f.path)) === input.skill &&
          (!path || f.path.startsWith(`${path}/`)),
      );
      if (matches.length !== 1)
        throw invalidSource(
          "Skill name is missing or ambiguous in the repository. Use a GitHub tree link to its folder.",
        );
      path = posix.dirname(matches[0]!.path);
      if (path === ".") path = "";
    }
    const source: ResolvedSource = {
      kind: "git",
      hub: input.hub,
      owner: input.owner,
      repo: input.repo,
      commit,
      path,
      pageUrl: `https://github.com/${input.owner}/${input.repo}/tree/${commit}${path ? `/${encodedPath(path)}` : ""}`,
    };
    const files = tree.tree
      .filter((f) => f.type !== "tree" && (!path || f.path.startsWith(`${path}/`)))
      .map((f): SourceFile => ({
        path: f.path,
        size: f.size ?? 0,
        symlink: f.mode === "120000" || f.type === "commit",
        read: () =>
          read(
            `https://raw.githubusercontent.com/${input.owner}/${input.repo}/${commit}/${encodedPath(f.path)}`,
            Math.min(f.size ?? ARCHIVE_LIMITS.fileBytes, ARCHIVE_LIMITS.fileBytes),
          ),
      }));
    validateFiles(files);
    return { source, files, label: input.repo, context: {} };
  }
  async function clawSource(
    input: Extract<SourceInput | ResolvedSource, { kind: "clawhub" }>,
  ): Promise<LoadedSource> {
    const api = `https://clawhub.ai/api/v1/skills/${encodeURIComponent(input.slug)}`;
    const query = `ownerHandle=${encodeURIComponent(input.owner)}`;
    const details = await json(`${api}?${query}`, hubSkillSchema);
    if (details.owner.handle.toLowerCase() !== input.owner.toLowerCase())
      throw invalidSource("ClawHub owner does not match the requested handle.");
    const version = input.version ?? details.latestVersion?.version;
    if (!version) throw notFound();
    const source = sourceReadSchema.shape.source.safeParse({
      kind: "clawhub",
      owner: details.owner.handle,
      slug: details.skill.slug,
      version,
      pageUrl: `https://clawhub.ai/${details.owner.handle}/skills/${details.skill.slug}`,
    });
    if (!source.success || typeof source.data === "string" || source.data.kind !== "clawhub")
      throw invalidSource("ClawHub returned invalid coordinates.");
    const pinned = source.data;
    const canonicalApi = `https://clawhub.ai/api/v1/skills/${encodeURIComponent(pinned.slug)}`;
    const pinnedQuery = `ownerHandle=${encodeURIComponent(pinned.owner)}`;
    const release = (
      await json(
        `${canonicalApi}/versions/${encodeURIComponent(version)}?${pinnedQuery}`,
        versionSchema,
      )
    ).version;
    if (release.version !== version)
      throw new ApplicationError(
        "SKILL_SOURCE_UNAVAILABLE",
        502,
        "ClawHub returned a different version.",
      );
    let archive: Promise<Map<string, ScanFile>> | undefined;
    const getArchive = () =>
      (archive ??= (async () => {
        const bytes = await read(
          `https://clawhub.ai/api/v1/download?slug=${encodeURIComponent(pinned.slug)}&version=${encodeURIComponent(version)}&${pinnedQuery}`,
          ARCHIVE_LIMITS.totalBytes,
        );
        return new Map(extractSkillZip(bytes).map((f) => [f.path, f]));
      })());
    const files = release.files.map((f): SourceFile => ({
      path: f.path,
      size: f.size,
      read: async () => {
        const file = (await getArchive()).get(f.path);
        if (!file || file.bytes.byteLength !== f.size || sha256(file.bytes) !== f.sha256)
          throw new ApplicationError(
            "SKILL_SOURCE_UNAVAILABLE",
            502,
            "ClawHub file failed pinned manifest verification.",
          );
        return file.bytes;
      },
    }));
    validateFiles(files);
    const statuses = [release.security, ...Object.values(release.security?.scanners ?? {})].filter(
      (s) => s !== null && s !== undefined,
    );
    const moderation = details.moderation;
    const suspicious = !!(
      moderation?.isSuspicious ||
      moderation?.isMalwareBlocked ||
      statuses.some((s) => /suspicious|malicious/i.test(s.status ?? ""))
    );
    const warnings =
      moderation?.hasWarnings ||
      statuses.some((s) => s.hasWarnings || /warn/i.test(s.status ?? ""));
    return {
      source: pinned,
      files,
      label: pinned.slug,
      context:
        suspicious || warnings
          ? {
              hubVerdict: {
                suspicious,
                message: suspicious
                  ? "ClawHub moderation or version security reports suspicious or malicious content."
                  : "ClawHub reports security warnings.",
              },
            }
          : {},
    };
  }
  function spaceManifest(userId: string, nodeId: string) {
    const root = options.access.resolveNode(userId, nodeId);
    if (!root) throw notFound();
    const files: { path: string; resource: BlobResourceAccess }[] = [];
    const entries: unknown[] = [[root.id, root.name]];
    const visited = new Set<string>();
    function walk(id: string, path: string) {
      if (visited.has(id) || visited.size >= ARCHIVE_LIMITS.entries) throw limit();
      visited.add(id);
      const node = options.access.resolveNode(userId, id);
      if (!node) throw notFound();
      if (node.resourceId) {
        const resource = options.access.resolveResource(userId, node.resourceId);
        if (!resource || !resource.capabilities.openContent) throw notFound();
        if (resource.kind !== "blob" || resource.availability !== "ready")
          throw invalidSource("Space Skill sources must contain available Blob files only.");
        files.push({ path, resource });
        entries.push([id, path, resource.id, resource.etag]);
      } else {
        if (!node.capabilities.browseChildren) throw notFound();
        entries.push([id, path]);
        const children = options.nodes.listChildren(
          node.spaceId,
          id,
          null,
          ARCHIVE_LIMITS.entries + 1,
        );
        if (children.length > ARCHIVE_LIMITS.entries) throw limit();
        for (const child of children) walk(child.id, path ? `${path}/${child.name}` : child.name);
      }
    }
    walk(nodeId, root.resourceId ? root.name : "");
    const etag = root.resourceId ? files[0]!.resource.etag : sha256(JSON.stringify(entries));
    return { files, root, etag: `"${etag}"` };
  }
  async function readBlob(resource: BlobResourceAccess, maxBytes: number): Promise<Buffer> {
    if (resource.byteSize > maxBytes) throw limit();
    const opened = await options.store.open({ objectKey: resource.objectKey });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of opened.stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > resource.byteSize || size > maxBytes) {
        opened.stream.destroy();
        throw limit();
      }
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks);
    if (size !== resource.byteSize || sha256(bytes) !== resource.sha256) throw conflict();
    return bytes;
  }
  async function spaceSource(
    userId: string,
    input: Extract<SourceInput | ResolvedSource, { kind: "space" }>,
  ): Promise<LoadedSource> {
    const manifest = spaceManifest(userId, input.nodeId);
    if ("etag" in input && manifest.etag !== input.etag) throw conflict();
    const source: ResolvedSource = { kind: "space", nodeId: input.nodeId, etag: manifest.etag };
    const check = () => {
      if (spaceManifest(userId, input.nodeId).etag !== source.etag) throw conflict();
    };
    let files: SourceFile[];
    if (manifest.root.resourceId) {
      if (
        !/\.zip$/i.test(manifest.root.name) &&
        manifest.files[0]!.resource.mediaType !== "application/zip"
      )
        throw invalidSource("The Space source must be a zip Blob or folder.");
      files = extractSkillZip(
        await readBlob(manifest.files[0]!.resource, ARCHIVE_LIMITS.totalBytes),
      ).map((f) => ({ path: f.path, size: f.bytes.byteLength, read: async () => f.bytes }));
    } else
      files = manifest.files.map(({ path, resource }) => ({
        path,
        size: resource.byteSize,
        read: () => readBlob(resource, ARCHIVE_LIMITS.fileBytes),
      }));
    validateFiles(files);
    check();
    return { source, files, label: manifest.root.name, context: {}, check };
  }
  async function load(userId: string, input: string | ResolvedSource): Promise<LoadedSource> {
    const parsed = typeof input === "string" ? parseSkillSource(input) : input;
    switch (parsed.kind) {
      case "git":
        return gitSource(parsed);
      case "clawhub":
        return clawSource(parsed);
      case "space":
        return spaceSource(userId, parsed);
    }
  }
  async function selected(loaded: LoadedSource, path: string) {
    const manifestPath = path === "." ? "SKILL.md" : `${path}/SKILL.md`;
    const manifest = loaded.files.find((f) => f.path === manifestPath);
    if (!manifest) throw notFound();
    const info = await candidate(loaded.files, manifest);
    const ownFiles = skillFiles(loaded.files, path);
    if (ownFiles.length > 100 || ownFiles.reduce((n, f) => n + f.size, 0) > 20 * 1024 * 1024)
      throw limit();
    const files: ScanFile[] = [];
    for (const file of ownFiles) {
      if (file.path === "SKILL.md" && file.size > 64 * 1024) throw limit();
      const bytes = await file.read();
      if (bytes.byteLength !== file.size)
        throw new ApplicationError(
          "SKILL_SOURCE_UNAVAILABLE",
          502,
          "Source file length differs from its manifest.",
        );
      files.push({ path: file.path, bytes });
      checkSkillLimits(files);
    }
    loaded.check?.();
    return { ...info, files };
  }
  return {
    async read(userId: string, body: unknown) {
      const parsed = sourceReadSchema.safeParse(body);
      if (!parsed.success)
        throw invalidSource(
          "Invalid source read request. path needs skill, and cursor needs path.",
        );
      const input = parsed.data;
      const loaded = await load(userId, input.source);
      if (input.skill === undefined) {
        const candidates: SourceCandidate[] = [];
        for (const file of loaded.files.filter((f) => posix.basename(f.path) === "SKILL.md")) {
          if (candidates.length >= 100) throw limit();
          candidates.push(await candidate(loaded.files, file));
        }
        loaded.check?.();
        return { source: loaded.source, candidates };
      }
      const skill = await selected(loaded, input.skill);
      if (input.path !== undefined) {
        if (!safeSkillPath(input.path)) throw invalidSource("Invalid Skill file path.");
        const file = skill.files.find((f) => f.path === input.path);
        if (!file) throw notFound();
        const content = decodeSkillText(file.bytes);
        if (content === null) throw invalidSource("Binary Skill files cannot be read as text.");
        if (file.bytes.byteLength > 256 * 1024) throw limit();
        return pageSourceText(loaded.source, input.skill, input.path, content, input.cursor);
      }
      return {
        source: loaded.source,
        skill: {
          name: skill.name,
          description: skill.description,
          path: skill.path,
          files: skill.files.map((f) => ({
            path: f.path,
            byteSize: f.bytes.byteLength,
            kind: decodeSkillText(f.bytes) === null ? "binary" : "text",
          })),
          content: decodeSkillText(skill.files.find((f) => f.path === "SKILL.md")!.bytes) ?? "",
        },
        scan: await scanSkill(skill.name, skill.files, loaded.context),
      };
    },
    async intake(userId: string, source: ResolvedSource, skill: string) {
      const loaded = await load(userId, source);
      return {
        source: loaded.source,
        label: loaded.label,
        context: loaded.context,
        files: (await selected(loaded, skill)).files,
      };
    },
  };
}

function pageSourceText(
  source: ResolvedSource,
  skill: string,
  path: string,
  text: string,
  cursor?: string,
) {
  const digest = sha256(JSON.stringify([source, skill, path, sha256(text)])).slice(0, 16);
  let start = 0;
  if (cursor !== undefined) {
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
      throw invalidSource("Invalid source file cursor.");
    }
    const parsed = z
      .object({ o: z.number().int().nonnegative().max(text.length), d: z.literal(digest) })
      .strict()
      .safeParse(value);
    if (!parsed.success)
      throw invalidSource("Cursor does not belong to this source, version and path.");
    start = parsed.data.o;
  }
  let end = text.length;
  while (
    end > start &&
    JSON.stringify({ path, content: text.slice(start, end) }).length + 512 > 100_000
  )
    end = start + Math.floor((end - start) * 0.8);
  const last = text.charCodeAt(end - 1);
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
  return {
    path,
    content: text.slice(start, end),
    ...(end < text.length
      ? {
          truncated: true,
          cursor: Buffer.from(JSON.stringify({ o: end, d: digest })).toString("base64url"),
        }
      : {}),
  };
}
