import { loadConfig } from "../config.js";
import { openProductDatabase } from "./index.js";

const outcomes = {
  grant: { changed: "now has", unchanged: "already has" },
  revoke: { changed: "no longer has", unchanged: "already has no" },
} as const;

const [action, target, ...rest] = process.argv.slice(2);
const change = action === "grant" || action === "revoke" ? action : null;
if (change ? !target || rest.length > 0 : action !== "list" || target !== undefined) {
  console.error("Usage: db:executor-access grant|revoke <username or user id> | list");
  process.exit(1);
}

const database = await openProductDatabase(loadConfig().database);
try {
  const identity = database.repositories.identity;
  if (change) {
    const result = await identity.setExecutorAccess(target!, change === "grant", Date.now());
    if (result) {
      const outcome = outcomes[change][result.changed ? "changed" : "unchanged"];
      console.info(`${result.username} (${result.id}) ${outcome} executor access`);
    } else {
      console.error(`No User matches ${target}`);
      process.exitCode = 1;
    }
  } else {
    for (const entry of await identity.listExecutorAccess()) {
      console.info(`${entry.username}\t${entry.id}\t${entry.kind}\t${new Date(entry.grantedAt).toISOString()}`);
    }
  }
} finally {
  await database.close();
}
