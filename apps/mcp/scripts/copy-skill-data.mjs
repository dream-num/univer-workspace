import { cpSync, rmSync } from "node:fs";

// The gateway serves the CLI's Skills from its own package; it never imports apps/cli at runtime.
const source = new URL("../../cli/skill-data", import.meta.url);
const target = new URL("../dist/skill-data", import.meta.url);
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
