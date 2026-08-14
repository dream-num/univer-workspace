import { createRequire } from "node:module";

declare const __UNIVER_WORKSPACE_CLI_VERSION__: string | undefined;

const require = createRequire(import.meta.url);

export const WORKSPACE_CLI_VERSION =
  typeof __UNIVER_WORKSPACE_CLI_VERSION__ === "string"
    ? __UNIVER_WORKSPACE_CLI_VERSION__
    : readPackageVersion(require("../package.json") as unknown);

function readPackageVersion(manifest: unknown): string {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("version" in manifest) ||
    typeof manifest.version !== "string" ||
    manifest.version.trim().length === 0
  ) {
    throw new Error("Workspace CLI package version is missing or invalid");
  }
  return manifest.version;
}
