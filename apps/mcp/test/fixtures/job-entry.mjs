import { registerHooks } from "node:module";
import { tsImport } from "tsx/esm/api";

// Match Vitest's workspace source exports without requiring a build.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier, {
      ...context,
      conditions: [...context.conditions, "development"],
    });
  },
});
await tsImport("../../src/executor/jobs/entry.ts", import.meta.url);
