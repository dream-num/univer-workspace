import { lstat, mkdir, rename, symlink } from "node:fs/promises";
import { dirname } from "node:path";
import { workspacePathFor, workspacePathForOrigin } from "./identity.ts";

const migrations = new Map<string, Promise<void>>();

export async function migrateLegacyUserDirectory(workspaceRoot: string, origin: string, userId: string): Promise<void> {
  const legacy = workspacePathFor(workspaceRoot, userId);
  const current = workspacePathForOrigin(workspaceRoot, origin, userId);
  if (!legacy.ok || !current.ok || legacy.path === current.path) return;
  const key = current.path;
  const existing = migrations.get(key);
  if (existing !== undefined) return existing;
  const operation = migrate(legacy.path, current.path);
  migrations.set(key, operation);
  try {
    await operation;
  } finally {
    if (migrations.get(key) === operation) migrations.delete(key);
  }
}

async function migrate(legacyPath: string, currentPath: string): Promise<void> {
  await mkdir(dirname(currentPath), { recursive: true });
  try {
    await lstat(currentPath);
    return;
  } catch (error) {
    if (!isMissing(error)) return;
  }
  let legacy;
  try {
    legacy = await lstat(legacyPath);
  } catch (error) {
    if (isMissing(error)) return;
    return;
  }
  if (!legacy.isDirectory()) return;
  try {
    await rename(legacyPath, currentPath);
    // Session headers written by the pre-origin client still contain the
    // legacy cwd. Keep that path as a compatibility alias; canonical path
    // checks resolve it into the new origin root, while other origins do not
    // treat the alias as their own root.
    try { await symlink(currentPath, legacyPath, "dir"); } catch { /* best effort */ }
  } catch (error) {
    if (!isAlreadyExists(error)) return;
  }
}

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error
    && (error.code === "EEXIST" || error.code === "ENOTEMPTY");
}
