import { resolve } from "node:path";
import { publishPreparedRelease } from "./publisher.mjs";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
let manifestPath = ".release/release-manifest.json";
let publish = false;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--publish") {
    publish = true;
    continue;
  }
  if (argument.startsWith("--manifest=")) {
    manifestPath = argument.slice("--manifest=".length);
    continue;
  }
  if (argument === "--manifest" && args[index + 1] !== undefined) {
    manifestPath = args[index + 1];
    index += 1;
    continue;
  }
  throw new Error(`Unknown publish argument: ${argument}`);
}
if (!publish) {
  throw new Error("Publishing requires the explicit --publish flag.");
}
const manifest = await publishPreparedRelease(resolve(manifestPath));
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
