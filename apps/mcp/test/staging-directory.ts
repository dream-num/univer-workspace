import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
const directories: string[] = [];
export function testStagingDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "mcp-staging-test-"));
  directories.push(path);
  return path;
}
afterAll(() => {
  for (const path of directories) rmSync(path, { recursive: true, force: true });
});
