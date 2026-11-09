import { tsImport } from "tsx/esm/api";
await tsImport("../../src/executor/jobs/entry.ts", import.meta.url);
setInterval(() => {}, 1000);
process.send("ready");
