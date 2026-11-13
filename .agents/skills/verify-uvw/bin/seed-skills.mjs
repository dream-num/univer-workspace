#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("./verify-uvw", import.meta.url));
const [space, name, source, ...extra] = process.argv.slice(2);
assert(space && name && source && !extra.length, "Usage: seed-skills.mjs <space> <skill-name> <source-dir>");
assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64, "Invalid skill name");
assert(process.env.VERIFY_UVW_RUN && process.env.UNIVER_HOME, "Run eval \"$($V env)\" first");
const uvw = (...args) => JSON.parse(execFileSync(helper, ["uvw", ...args, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
const repository = uvw("repo", "view", space);
const spaceId = repository.id;
assert(typeof spaceId === "string", "repo view must return a Space ID");
const counts = { createdFolders: 0, uploaded: 0, skipped: 0 };
function children(parent) {
  return uvw("space", "browse", spaceId, ...(parent ? ["--parent", parent] : [])).nodes;
}
function folder(parent, name) {
  const existing = children(parent).find((node) => node.name === name && node.resource === null);
  if (existing) return existing.nodeId;
  const { node } = uvw("space", "node", "create", spaceId, "--name", name, ...(parent ? ["--parent", parent] : []));
  counts.createdFolders++;
  assert(typeof node.nodeId === "string", "node create must return a Node ID");
  return node.nodeId;
}
async function upload(directory, parent) {
  const existing = children(parent);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await upload(path, folder(parent, entry.name));
    else if (entry.isFile()) {
      if (existing.some((node) => node.name === entry.name && node.resource?.kind === "blob")) {
        counts.skipped++;
        continue;
      }
      uvw("blob", "upload", "--file", path, "--space", spaceId, "--parent", parent, "--name", entry.name);
      counts.uploaded++;
    } else assert.fail("Skill source must contain only regular files and directories");
  }
}
const agents = folder(undefined, ".agents");
const skills = folder(agents, "skills");
await upload(resolve(source), folder(skills, name));
process.stdout.write(`${JSON.stringify(counts)}\n`);
