#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, readlink, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const installHome = resolve(requiredEnvironment("DSH_HOME"));
const dataHome = resolve(process.env.UWH_DSH_DATA_HOME ?? installHome);
const statePath = resolve(
  process.env.UWH_CONNECTION_STATE_PATH ?? resolve(dataHome, "connection.json"),
);
const sharedCredentialsPath = resolve(
  process.env.UWH_SHARED_CREDENTIALS_PATH ?? resolve(dataHome, "shared", ".credentials.yaml"),
);
const profileName = process.env.DSH_PROFILE ?? "univer-workspace-harness";
const dshBin = resolve(requiredEnvironment("DSH_BIN"));
const pollMs = positiveInteger(process.env.UWH_CONNECTION_POLL_MS, 500);
const dshArgs = [dshBin, "--profile", profileName, ...process.argv.slice(2)];

let child;
let stoppingSignal;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stoppingSignal = signal;
    child?.kill(signal);
  });
}

await mkdir(dirname(sharedCredentialsPath), { recursive: true, mode: 0o700 });
await migrateSharedCredentials(sharedCredentialsPath);

while (stoppingSignal === undefined) {
  const active = await readActiveConnection(statePath);
  const launchedFingerprint = connectionFingerprint(active);
  const runtimeHome = runtimeHomeFor(active);
  await mkdir(runtimeHome, { recursive: true, mode: 0o700 });
  await ensureProfileLink(resolve(runtimeHome, "profiles"), resolve(installHome, "profiles"));

  const childEnvironment = {
    ...process.env,
    DSH_HOME: runtimeHome,
    UWH_CONNECTION_STATE_PATH: statePath,
    UWH_SHARED_CREDENTIALS_PATH: sharedCredentialsPath,
    ...(active === undefined ? {} : { UWH_WORKSPACE_ORIGIN: active.origin }),
  };
  if (active === undefined) delete childEnvironment.UWH_WORKSPACE_ORIGIN;
  console.error(
    `[uwh] starting ${active === undefined ? "unconnected" : `${active.identity.username} @ ${active.origin}`} with runtime ${runtimeHome}`,
  );
  const result = await runChild(childEnvironment, launchedFingerprint);
  if (result.switchRequested && stoppingSignal === undefined) continue;
  if (stoppingSignal !== undefined) break;
  if (result.error !== undefined) {
    console.error(`[uwh] failed to start DSH: ${result.error.message}`);
    process.exitCode = 1;
    break;
  }
  if (result.signal !== null) {
    stoppingSignal = result.signal;
    break;
  }
  process.exitCode = result.code ?? 1;
  break;
}

if (stoppingSignal !== undefined) {
  process.removeAllListeners(stoppingSignal);
  process.kill(process.pid, stoppingSignal);
}

function runChild(environment, launchedFingerprint) {
  return new Promise((resolveResult) => {
    let switchRequested = false;
    let checking = false;
    child = spawn(process.execPath, dshArgs, {
      env: environment,
      stdio: "inherit",
    });
    const timer = setInterval(() => {
      if (checking || switchRequested || stoppingSignal !== undefined) return;
      checking = true;
      void readActiveConnection(statePath)
        .then((next) => {
          if (connectionFingerprint(next) === launchedFingerprint) return;
          switchRequested = true;
          console.error("[uwh] Workspace connection changed; restarting DSH runtime");
          child?.kill("SIGTERM");
        })
        .catch((error) => {
          console.error(
            `[uwh] cannot read updated Workspace connection state: ${error instanceof Error ? error.message : String(error)}`,
          );
        })
        .finally(() => {
          checking = false;
        });
    }, pollMs);
    timer.unref();
    child.once("error", (error) => {
      clearInterval(timer);
      child = undefined;
      resolveResult({ code: null, signal: null, switchRequested, error });
    });
    child.once("exit", (code, signal) => {
      clearInterval(timer);
      child = undefined;
      resolveResult({ code, signal, switchRequested });
    });
  });
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 10) {
    throw new Error("UWH_CONNECTION_POLL_MS must be an integer of at least 10 milliseconds");
  }
  return parsed;
}

function runtimeHomeFor(active) {
  const runtimeName =
    active === undefined
      ? "bootstrap"
      : createHash("sha256")
          .update(active.origin, "utf8")
          .update("\0", "utf8")
          .update(active.identity.userId, "utf8")
          .digest("hex");
  return resolve(dataHome, "runtimes", runtimeName);
}

function connectionFingerprint(active) {
  if (active === undefined) return "unconnected";
  return createHash("sha256")
    .update(active.origin, "utf8")
    .update("\0", "utf8")
    .update(active.identity.userId, "utf8")
    .update("\0", "utf8")
    .update(active.sessionToken, "utf8")
    .digest("hex");
}

async function readActiveConnection(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  const state = JSON.parse(raw);
  if (state === null || typeof state !== "object" || state.version !== 1) {
    throw new Error(`Invalid Workspace connection state at ${path}`);
  }
  const active = state.active;
  if (active === undefined) return undefined;
  if (
    active === null ||
    typeof active !== "object" ||
    typeof active.origin !== "string" ||
    active.identity === null ||
    typeof active.identity !== "object" ||
    typeof active.identity.userId !== "string" ||
    typeof active.identity.username !== "string" ||
    typeof active.sessionToken !== "string"
  ) {
    throw new Error(`Invalid Workspace connection state at ${path}`);
  }
  const origin = new URL(active.origin);
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Error(`Invalid Workspace origin in ${path}`);
  }
  return { ...active, origin: origin.origin };
}

async function ensureProfileLink(linkPath, targetPath) {
  await mkdir(dirname(linkPath), { recursive: true, mode: 0o700 });
  try {
    const entry = await lstat(linkPath);
    if (!entry.isSymbolicLink()) {
      throw new Error(`${linkPath} exists and is not a symbolic link`);
    }
    if (resolve(dirname(linkPath), await readlink(linkPath)) !== targetPath) {
      throw new Error(`${linkPath} points at an unexpected profile directory`);
    }
    return;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await symlink(targetPath, linkPath, "dir");
}

async function migrateSharedCredentials(targetPath) {
  const candidates = [
    resolve(dataHome, "runtimes", "bootstrap", ".credentials.yaml"),
    resolve(installHome, ".credentials.yaml"),
  ];
  for (const candidate of candidates) {
    try {
      await copyFile(candidate, targetPath, constants.COPYFILE_EXCL);
      await chmod(targetPath, 0o600);
      console.error(`[uwh] migrated shared DSH credentials from ${candidate}`);
      return;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "EEXIST")
      ) {
        if (error.code === "EEXIST") return;
        continue;
      }
      throw error;
    }
  }
}
