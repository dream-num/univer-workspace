#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, realpath, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const installHome = resolve(requiredEnvironment("DSH_HOME"));
const dataHome = resolve(process.env.UWH_DSH_DATA_HOME ?? installHome);
const statePath = resolve(
  process.env.UWH_CONNECTION_STATE_PATH ?? resolve(dataHome, "connection.json"),
);
const sharedCredentialsPath = resolve(
  process.env.UWH_SHARED_CREDENTIALS_PATH ?? resolve(dataHome, "shared", ".credentials.yaml"),
);
const sharedSettingsPath = resolve(process.env.UWH_SHARED_SETTINGS_PATH ?? resolve(dataHome, "shared", "settings.yaml"));
const profileName = process.env.DSH_PROFILE ?? "univer-workspace-harness";
const dshBin = resolve(requiredEnvironment("DSH_BIN"));

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
await mkdir(dirname(sharedSettingsPath), { recursive: true, mode: 0o700 });
const initial = await readActiveConnection(statePath);
for (const candidate of [resolve(runtimeHomeFor(initial), "settings.yaml"), resolve(dataHome, "runtimes", "bootstrap", "settings.yaml"), resolve(installHome, "settings.yaml")]) {
  try {
    await copyFile(candidate, sharedSettingsPath, constants.COPYFILE_EXCL);
    await chmod(sharedSettingsPath, 0o600);
    break;
  } catch (error) {
    if (error?.code === "EEXIST") break;
    if (error?.code !== "ENOENT") throw error;
  }
}

while (stoppingSignal === undefined) {
  const active = await readActiveConnection(statePath);

  const runtimeHome = runtimeHomeFor(active);
  await mkdir(runtimeHome, { recursive: true, mode: 0o700 });
  await ensureProfileLink(resolve(runtimeHome, "profiles"), resolve(installHome, "profiles"));

  const childEnvironment = {
    ...process.env,
    DSH_HOME: runtimeHome,
    UWH_CONNECTION_STATE_PATH: statePath,
    UWH_SHARED_CREDENTIALS_PATH: sharedCredentialsPath,
    UWH_SHARED_SETTINGS_PATH: sharedSettingsPath,
    UWH_DSH_DATA_HOME: dataHome,
    ...(active === undefined ? {} : { UWH_WORKSPACE_ORIGIN: active.origin }),
  };
  if (active === undefined) delete childEnvironment.UWH_WORKSPACE_ORIGIN;
  console.error(
    `[uwh] starting ${active === undefined ? "unconnected" : `${active.identity.username} @ ${active.origin}`} with runtime ${runtimeHome}`,
  );
  const result = await runChild(childEnvironment);
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

function runChild(environment) {
  return new Promise((resolveResult) => {
    child = spawn(process.execPath, dshArgs, {
      env: environment,
      stdio: process.send ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
    });
    if (process.send) child.on("message", (message) => {
      if (message && typeof message === "object" && message.type === "uwh-desktop-ready" && typeof message.url === "string") {
        process.send?.({ type: "uwh-desktop-ready", url: message.url });
      }
    });
    child.once("error", (error) => {
      child = undefined;
      resolveResult({ code: null, signal: null, error });
    });
    child.once("exit", (code, signal) => {
      child = undefined;
      resolveResult({ code, signal });
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
    if (await realpath(linkPath) !== await realpath(targetPath)) {
      throw new Error(`${linkPath} points at an unexpected profile directory`);
    }
    return;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await symlink(targetPath, linkPath, process.platform === "win32" ? "junction" : "dir");
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
