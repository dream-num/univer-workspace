import type { WorkspaceCompileTypstResult } from "@univerjs/univer-workspace-client-core";
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readdir,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import type { WorkspaceTypstPreview } from "./typst-tools.js";

export const MAX_TYPST_ARTIFACT_BYTES = 52_428_800;
export const MAX_TYPST_PREVIEWS = 256;

interface OwnedPath {
  readonly dev: number;
  readonly ino: number;
  readonly kind: "directory" | "file";
  readonly path: string;
  readonly scope: "private" | "public";
  readonly size?: number;
}

export interface WorkspaceTypstArtifactStage {
  committed: boolean;
  readonly destination: string;
  readonly directories: OwnedPath[];
  readonly files: OwnedPath[];
  readonly parent: string;
  readonly previewDirectory?: string;
  readonly privateDirectory: string;
  publicStarted: boolean;
}

export class WorkspaceTypstArtifactError extends Error {
  public constructor(
    readonly code: "workspace-output-exists" | "workspace-typst-limit-exceeded",
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(code);
  }
}

export async function createTypstArtifactStage(
  destination: string,
  renderPreviews: boolean,
  signal: AbortSignal,
): Promise<WorkspaceTypstArtifactStage> {
  signal.throwIfAborted();
  if (await fenced(lstat(destination).catch(missingOnly), signal) !== undefined) throw outputExists();
  const parent = dirname(destination);
  if (!(await fenced(stat(parent), signal)).isDirectory()) throw new Error("artifact parent is not a directory");
  let privateDirectory: string;
  try {
    privateDirectory = await mkdtemp(join(parent, `.${basename(destination)}.`));
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  }
  try {
    signal.throwIfAborted();
  } catch (error) {
    await rmdir(privateDirectory).catch(() => undefined);
    throw error;
  }
  let root: OwnedPath;
  try {
    root = await ownedDirectory(privateDirectory, "private", signal);
  } catch (error) {
    await rmdir(privateDirectory).catch(() => undefined);
    throw error;
  }
  const stage: WorkspaceTypstArtifactStage = {
    committed: false,
    destination,
    directories: [root],
    files: [],
    parent,
    privateDirectory,
    publicStarted: false,
  };
  try {
    await fenced(chmod(privateDirectory, 0o700), signal);
    if (!renderPreviews) return stage;
    const previewDirectory = join(privateDirectory, "previews");
    try {
      await mkdir(previewDirectory, { mode: 0o700 });
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    }
    try {
      signal.throwIfAborted();
      stage.directories.push(await ownedDirectory(previewDirectory, "private", signal));
    } catch (error) {
      await rmdir(previewDirectory).catch(() => undefined);
      throw error;
    }
    return { ...stage, previewDirectory };
  } catch (error) {
    await cleanupTypstArtifactStage(stage);
    throw error;
  }
}

async function fenced<Value>(operation: Promise<Value>, signal: AbortSignal): Promise<Value> {
  return await operation.then(
    (value) => {
      signal.throwIfAborted();
      return value;
    },
    (error: unknown) => {
      signal.throwIfAborted();
      throw error;
    },
  );
}

export function projectTypstPreviews(
  previews: WorkspaceCompileTypstResult["previews"],
  artifactDirectory: string,
): readonly WorkspaceTypstPreview[] {
  return previews.map((preview) => ({
    pageId: preview.pageId,
    path: join(artifactDirectory, "previews", basename(preview.path)),
    sourcePath: preview.sourcePath,
  }));
}

export async function stageTypstArtifacts(
  stage: WorkspaceTypstArtifactStage,
  result: WorkspaceCompileTypstResult,
  renderPreviews: boolean,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const program = Buffer.from(result.javascript, "utf8");
  const diagnostics = Buffer.from(`${JSON.stringify({ schemaVersion: 1, diagnostics: result.diagnostics }, null, 2)}\n`, "utf8");
  const previewPaths = new Set<string>();
  if (!renderPreviews && result.previews.length > 0) throw new Error("unexpected Typst previews");
  if (renderPreviews) {
    if (stage.previewDirectory === undefined) throw new Error("missing private preview directory");
    for (const preview of result.previews) {
      const path = preview.path;
      if (!isDirectPng(stage.previewDirectory, path) || previewPaths.has(path)) {
        throw new Error("invalid Typst preview path");
      }
      previewPaths.add(path);
      const info = await lstat(path);
      signal.throwIfAborted();
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("invalid Typst preview file");
      stage.files.push(fileIdentity(path, "private", info));
    }
    await assertDirectoryLayout(
      privateDirectory(stage, stage.previewDirectory),
      new Set([...previewPaths].map((path) => basename(path))),
    );
  }
  if (result.previews.length > MAX_TYPST_PREVIEWS) {
    throw limitExceeded("preview-count", MAX_TYPST_PREVIEWS, result.previews.length);
  }
  await writeSynced(stage, join(stage.privateDirectory, "program.js"), program, signal);
  await writeSynced(stage, join(stage.privateDirectory, "diagnostics.json"), diagnostics, signal);
  for (const path of previewPaths) {
    signal.throwIfAborted();
    await chmod(path, 0o600);
    await syncOwnedFile(knownFile(stage, path, "private"));
  }
  if (stage.previewDirectory !== undefined) {
    await syncOwnedDirectory(privateDirectory(stage, stage.previewDirectory));
  }
  await syncOwnedDirectory(privateDirectory(stage, stage.privateDirectory));
  await validatePrivateStage(stage);
  signal.throwIfAborted();
}

export async function commitTypstArtifactStage(
  stage: WorkspaceTypstArtifactStage,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await validatePrivateStage(stage);
  try {
    await mkdir(stage.destination, { mode: 0o700 });
  } catch (error) {
    if (isNodeError(error, "EEXIST")) throw outputExists();
    throw error;
  }
  stage.publicStarted = true;
  stage.directories.push(await ownedDirectory(stage.destination, "public"));
  signal.throwIfAborted();
  await validatePublicStage(stage, false);

  const publicPreviewDirectory = stage.previewDirectory === undefined
    ? undefined
    : join(stage.destination, "previews");
  if (publicPreviewDirectory !== undefined) {
    await validatePublicStage(stage, false);
    await mkdir(publicPreviewDirectory, { mode: 0o700 });
    stage.directories.push(await ownedDirectory(publicPreviewDirectory, "public"));
    signal.throwIfAborted();
    await validatePublicStage(stage, false);
  }

  const privateFiles = [
    knownFile(stage, join(stage.privateDirectory, "program.js"), "private"),
    knownFile(stage, join(stage.privateDirectory, "diagnostics.json"), "private"),
    ...stage.files.filter((entry) =>
      entry.scope === "private" && dirname(entry.path) === stage.previewDirectory),
  ];
  for (const source of privateFiles) {
    signal.throwIfAborted();
    await validatePrivateStage(stage);
    await validatePublicStage(stage, false);
    const child = relative(stage.privateDirectory, source.path);
    await publishKnownFile(stage, source, join(stage.destination, child), signal);
  }

  await validatePublicStage(stage, true);
  if (publicPreviewDirectory !== undefined) {
    await syncOwnedDirectory(publicDirectory(stage, publicPreviewDirectory));
    await validatePublicStage(stage, true);
  }
  await syncOwnedDirectory(publicDirectory(stage, stage.destination));
  await validatePublicStage(stage, true);
  await syncPath(stage.parent);
  signal.throwIfAborted();
  await validatePublicStage(stage, true);
  await cleanupOwned(stage, "private");
  await validatePublicStage(stage, true);
  // ponytail: observed-drift checks only; use OS-user/container isolation for hostile same-UID writers.
  stage.committed = true;
}

export async function cleanupTypstArtifactStage(stage: WorkspaceTypstArtifactStage): Promise<void> {
  // Public paths become caller-visible at reservation time and are never deleted here.
  await cleanupOwned(stage, "private");
}

async function publishKnownFile(
  stage: WorkspaceTypstArtifactStage,
  source: OwnedPath,
  destination: string,
  signal: AbortSignal,
): Promise<void> {
  await assertOwnedFile(source);
  const expectedParent = dirname(destination) === stage.destination
    ? publicDirectory(stage, stage.destination)
    : publicDirectory(stage, dirname(destination));
  await assertOwnedDirectory(expectedParent);
  try {
    await link(source.path, destination);
  } catch (error) {
    if (isNodeError(error, "EEXIST")) throw new Error("public artifact path already exists");
    throw error;
  }
  const published: OwnedPath = { ...source, path: destination, scope: "public" };
  stage.files.push(published);
  signal.throwIfAborted();
  await syncOwnedFile(published);
  await validatePublicStage(stage, false);
}

async function writeSynced(
  stage: WorkspaceTypstArtifactStage,
  path: string,
  value: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const handle = await open(path, "wx", 0o600);
  try {
    const initial = await handle.stat();
    stage.files.push({ ...fileIdentity(path, "private", initial), size: value.byteLength });
    await handle.writeFile(value);
    signal.throwIfAborted();
    const completed = await handle.stat();
    if (!completed.isFile() || completed.size !== value.byteLength) throw new Error("private artifact changed");
    await handle.sync();
  } finally {
    await handle.close();
  }
  signal.throwIfAborted();
}

async function validatePrivateStage(stage: WorkspaceTypstArtifactStage): Promise<void> {
  const root = privateDirectory(stage, stage.privateDirectory);
  const rootFiles = stage.files.filter((entry) =>
    entry.scope === "private" && dirname(entry.path) === stage.privateDirectory);
  const rootNames = new Set(rootFiles.map((entry) => basename(entry.path)));
  if (stage.previewDirectory !== undefined) rootNames.add("previews");
  await assertDirectoryLayout(root, rootNames);

  if (stage.previewDirectory !== undefined) {
    const previews = stage.files.filter((entry) =>
      entry.scope === "private" && dirname(entry.path) === stage.previewDirectory);
    await assertDirectoryLayout(
      privateDirectory(stage, stage.previewDirectory),
      new Set(previews.map((entry) => basename(entry.path))),
    );
  }
  await validateFilesAndBytes(stage.files.filter((entry) => entry.scope === "private"));
}

async function validatePublicStage(stage: WorkspaceTypstArtifactStage, complete: boolean): Promise<void> {
  const destination = publicDirectory(stage, stage.destination);
  const publicFiles = stage.files.filter((entry) => entry.scope === "public");
  const rootFiles = publicFiles.filter((entry) => dirname(entry.path) === stage.destination);
  const rootNames = new Set(rootFiles.map((entry) => basename(entry.path)));
  const previewDirectory = stage.directories.find((entry) =>
    entry.scope === "public" && entry.path === join(stage.destination, "previews"));
  if (previewDirectory !== undefined) rootNames.add("previews");
  await assertDirectoryLayout(destination, rootNames);

  if (previewDirectory !== undefined) {
    const previews = publicFiles.filter((entry) => dirname(entry.path) === previewDirectory.path);
    await assertDirectoryLayout(previewDirectory, new Set(previews.map((entry) => basename(entry.path))));
  }
  await validateFilesAndBytes(publicFiles);
  if (complete) {
    const expected = new Set(stage.files.filter((entry) => entry.scope === "private")
      .map((entry) => relative(stage.privateDirectory, entry.path)));
    const actual = new Set(publicFiles.map((entry) => relative(stage.destination, entry.path)));
    if (!sameNames(actual, expected)) throw new Error("incomplete public artifact layout");
  }
}

async function validateFilesAndBytes(files: readonly OwnedPath[]): Promise<void> {
  let totalBytes = 0;
  for (const file of files) {
    const info = await assertOwnedFile(file);
    totalBytes += info.size;
  }
  if (totalBytes > MAX_TYPST_ARTIFACT_BYTES) {
    throw limitExceeded("artifact-bytes", MAX_TYPST_ARTIFACT_BYTES, totalBytes);
  }
}

async function assertDirectoryLayout(directory: OwnedPath, expected: ReadonlySet<string>): Promise<void> {
  await assertOwnedDirectory(directory);
  const entries = await readdir(directory.path);
  await assertOwnedDirectory(directory);
  if (!sameNames(new Set(entries), expected)) throw new Error("unexpected Typst artifact layout");
}

function sameNames(actual: ReadonlySet<string>, expected: ReadonlySet<string>): boolean {
  return actual.size === expected.size && [...actual].every((name) => expected.has(name));
}

async function syncOwnedFile(entry: OwnedPath): Promise<void> {
  const handle = await open(entry.path, "r");
  try {
    const info = await handle.stat();
    assertIdentity(entry, info);
    if (!info.isFile() || info.size !== entry.size) throw new Error("artifact file changed");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assertOwnedFile(entry);
}

async function syncOwnedDirectory(entry: OwnedPath): Promise<void> {
  const handle = await open(entry.path, "r");
  try {
    const info = await handle.stat();
    assertIdentity(entry, info);
    if (!info.isDirectory()) throw new Error("artifact directory changed");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assertOwnedDirectory(entry);
}

async function cleanupOwned(stage: WorkspaceTypstArtifactStage, scope: OwnedPath["scope"]): Promise<void> {
  for (const entry of [...stage.files].reverse()) {
    if (entry.scope === scope) await unlinkIfOwned(entry).catch(() => undefined);
  }
  for (const entry of [...stage.directories].reverse()) {
    if (entry.scope === scope) await rmdirIfOwned(entry).catch(() => undefined);
  }
}

async function unlinkIfOwned(entry: OwnedPath): Promise<void> {
  // ponytail: portable Node has no conditional unlink; use dirfd/native unlinkat if same-UID isolation is required.
  if (entry.kind === "file" && await isOwned(entry)) await unlink(entry.path);
}

async function rmdirIfOwned(entry: OwnedPath): Promise<void> {
  if (entry.kind === "directory" && await isOwned(entry)) await rmdir(entry.path);
}

async function isOwned(entry: OwnedPath): Promise<boolean> {
  const info = await lstat(entry.path).catch(missingOnly);
  return info !== undefined
    && info.dev === entry.dev
    && info.ino === entry.ino
    && (entry.kind === "file" ? info.isFile() && !info.isSymbolicLink() : info.isDirectory());
}

async function assertOwnedFile(entry: OwnedPath) {
  const info = await lstat(entry.path);
  assertIdentity(entry, info);
  if (entry.kind !== "file" || !info.isFile() || info.isSymbolicLink() || info.size !== entry.size) {
    throw new Error("artifact file changed");
  }
  return info;
}

async function assertOwnedDirectory(entry: OwnedPath): Promise<void> {
  const info = await lstat(entry.path);
  assertIdentity(entry, info);
  if (entry.kind !== "directory" || !info.isDirectory()) throw new Error("artifact directory changed");
}

function assertIdentity(entry: OwnedPath, info: { readonly dev: number; readonly ino: number }): void {
  if (info.dev !== entry.dev || info.ino !== entry.ino) throw new Error("artifact identity changed");
}

async function ownedDirectory(
  path: string,
  scope: OwnedPath["scope"],
  signal?: AbortSignal,
): Promise<OwnedPath> {
  const info = signal === undefined ? await lstat(path) : await fenced(lstat(path), signal);
  if (!info.isDirectory()) throw new Error("artifact directory changed");
  return { dev: info.dev, ino: info.ino, kind: "directory", path, scope };
}

function fileIdentity(
  path: string,
  scope: OwnedPath["scope"],
  info: { readonly dev: number; readonly ino: number; readonly size: number },
): OwnedPath {
  return { dev: info.dev, ino: info.ino, kind: "file", path, scope, size: info.size };
}

function privateDirectory(stage: WorkspaceTypstArtifactStage, path: string): OwnedPath {
  const entry = stage.directories.find((candidate) => candidate.scope === "private" && candidate.path === path);
  if (entry === undefined) throw new Error("missing private artifact directory identity");
  return entry;
}

function publicDirectory(stage: WorkspaceTypstArtifactStage, path: string): OwnedPath {
  const entry = stage.directories.find((candidate) => candidate.scope === "public" && candidate.path === path);
  if (entry === undefined) throw new Error("missing public artifact directory identity");
  return entry;
}

function knownFile(stage: WorkspaceTypstArtifactStage, path: string, scope: OwnedPath["scope"]): OwnedPath {
  const entry = stage.files.find((candidate) => candidate.scope === scope && candidate.path === path);
  if (entry === undefined) throw new Error("missing artifact file identity");
  return entry;
}

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isDirectPng(parent: string, path: string): boolean {
  const child = relative(parent, path);
  return child !== ""
    && child === basename(child)
    && !child.startsWith(".")
    && extname(child).toLowerCase() === ".png";
}

function missingOnly(error: unknown): undefined {
  if (isNodeError(error, "ENOENT")) return undefined;
  throw error;
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function outputExists(): WorkspaceTypstArtifactError {
  return new WorkspaceTypstArtifactError("workspace-output-exists");
}

function limitExceeded(kind: string, limit: number, actual: number): WorkspaceTypstArtifactError {
  return new WorkspaceTypstArtifactError("workspace-typst-limit-exceeded", { actual, kind, limit });
}
