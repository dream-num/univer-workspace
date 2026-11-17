import { loadConfig } from "../config.js";
import { openProductDatabase } from "./index.js";
import { describeUser, resolveOperatorTarget } from "./operator-target.js";

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
    const user = await resolveOperatorTarget(identity, target!);
    if (user) {
      const changed = await identity.setExecutorAccess(user.id, change === "grant", Date.now());
      console.info(`${describeUser(user)} ${outcomes[change][changed ? "changed" : "unchanged"]} executor access`);
    }
  } else {
    const entries = await identity.listExecutorAccess();
    // stderr keeps stdout one tab-separated line per granted User for scripts.
    if (entries.length === 0) console.error("No users have executor access");
    for (const entry of entries) {
      console.info(`${entry.username}\t${entry.id}\t${entry.kind}\t${new Date(entry.grantedAt).toISOString()}`);
    }
  }
} finally {
  await database.close();
}
