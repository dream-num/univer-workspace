import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const packageRoot = resolve(process.argv[2] ?? "package-dist");
const temporaryRoot = await mkdtemp(join(tmpdir(), "univer-workspace-cli-package-"));
let executable;
let smokeEnv;

try {
  const tarballRoot = join(temporaryRoot, "tarball");
  const installRoot = join(temporaryRoot, "install");
  const univerHome = join(temporaryRoot, "home");
  await Promise.all([mkdir(tarballRoot), mkdir(installRoot), mkdir(univerHome)]);

  const packed = run(
    "npm",
    ["pack", "--json", `--pack-destination=${tarballRoot}`],
    packageRoot,
  );
  const artifacts = JSON.parse(packed.stdout);
  if (!Array.isArray(artifacts) || artifacts.length !== 1) {
    throw new Error("npm pack must produce exactly one artifact");
  }
  const tarball = join(tarballRoot, basename(artifacts[0].filename));
  run(
    "npm",
    ["install", "--no-audit", "--no-fund", "--package-lock=false", tarball],
    installRoot,
  );

  executable = join(
    installRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "univer-workspace-cli.cmd" : "univer-workspace-cli",
  );
  smokeEnv = { ...process.env, UNIVER_HOME: univerHome };
  run(executable, ["--version"], installRoot, smokeEnv);
  run(executable, ["--help"], installRoot, smokeEnv);
  run(executable, ["skills", "list", "--json"], installRoot, smokeEnv);
  run(executable, ["api", "--help"], installRoot, smokeEnv);
  run(executable, ["daemon", "start", "--json"], installRoot, smokeEnv);
  run(executable, ["daemon", "status", "--json"], installRoot, smokeEnv);
  run(executable, ["daemon", "stop", "--json"], installRoot, smokeEnv);
  console.log("[package-smoke] installed tarball commands passed");
} finally {
  if (executable !== undefined && smokeEnv !== undefined) {
    spawnSync(executable, ["daemon", "stop", "--json"], {
      cwd: temporaryRoot,
      encoding: "utf8",
      env: smokeEnv,
      shell: process.platform === "win32",
    });
  }
  await rm(temporaryRoot, { force: true, recursive: true });
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result;
}
