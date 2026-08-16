import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  assertReleaseContext,
  validateReleaseManifest,
} from "./policy.mjs";

export async function publishPreparedRelease(manifestPath, env = process.env) {
  const absoluteManifestPath = resolve(manifestPath);
  const manifest = validateReleaseManifest(
    JSON.parse(await readFile(absoluteManifestPath, "utf8")),
  );
  assertReleaseContext(manifest.channel, manifest.version, env);
  const tarballPath = join(dirname(absoluteManifestPath), manifest.tarball);
  const tarball = await readFile(tarballPath);
  const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
  if (integrity !== manifest.integrity) {
    throw new Error("Prepared tarball integrity differs from the reviewed release manifest.");
  }

  const existingIntegrity = readRegistryIntegrity(manifest, dirname(absoluteManifestPath), env);
  if (existingIntegrity === undefined) {
    run(
      "npm",
      [
        "publish",
        tarballPath,
        "--ignore-scripts",
        "--registry",
        manifest.registry,
        "--tag",
        manifest.npmTag,
      ],
      dirname(absoluteManifestPath),
      env,
    );
  } else if (existingIntegrity !== manifest.integrity) {
    throw new Error(
      `Registry already contains ${manifest.package}@${manifest.version} with different integrity.`,
    );
  } else {
    process.stdout.write(
      `[release] Reusing existing ${manifest.package}@${manifest.version} with matching integrity.\n`,
    );
  }

  const publishedVersion = JSON.parse(
    capture(
      "npm",
      [
        "view",
        `${manifest.package}@${manifest.version}`,
        "version",
        "--json",
        "--registry",
        manifest.registry,
      ],
      dirname(absoluteManifestPath),
      env,
    ),
  );
  if (publishedVersion !== manifest.version) {
    throw new Error(
      `Registry readback expected ${manifest.version}, got ${String(publishedVersion)}.`,
    );
  }
  const distTags = JSON.parse(
    capture(
      "npm",
      ["view", manifest.package, "dist-tags", "--json", "--registry", manifest.registry],
      dirname(absoluteManifestPath),
      env,
    ),
  );
  if (distTags?.[manifest.npmTag] !== manifest.version) {
    throw new Error(
      `Registry dist-tag ${manifest.npmTag} does not point to ${manifest.version}.`,
    );
  }
  return manifest;
}

function readRegistryIntegrity(manifest, cwd, env) {
  const result = runResult(
    "npm",
    [
      "view",
      `${manifest.package}@${manifest.version}`,
      "dist.integrity",
      "--json",
      "--registry",
      manifest.registry,
    ],
    cwd,
    env,
  );
  if (result.status === 0) {
    const integrity = JSON.parse(result.stdout);
    if (typeof integrity !== "string") {
      throw new Error("Registry returned an invalid exact-version integrity.");
    }
    return integrity;
  }
  const diagnostic = `${result.stdout}\n${result.stderr}`;
  if (/\bE404\b|404 Not Found/u.test(diagnostic)) {
    return undefined;
  }
  throw new Error(
    `Unable to inspect ${manifest.package}@${manifest.version}:\n${result.stderr || result.stdout}`,
  );
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    throw new Error(`Unable to run ${command}.`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${String(result.status)}.`);
  }
}

function capture(command, args, cwd, env) {
  const result = runResult(command, args, cwd, env);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${String(result.status)}:\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function runResult(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    shell: process.platform === "win32",
  });
  if (result.error !== undefined) {
    throw new Error(`Unable to run ${command}.`, { cause: result.error });
  }
  return {
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}
