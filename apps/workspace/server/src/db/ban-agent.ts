import { loadConfig } from "../config.js";
import { openWorkspaceDatabase } from "./initialize.js";

const target = process.argv[2];
if (!target) {
  console.error("Usage: db:ban-agent <username or user id>");
  process.exit(1);
}

const database = openWorkspaceDatabase(loadConfig().databaseFilename);
try {
  const user = database.connection
    .prepare("SELECT id, username, kind FROM users WHERE id = ? OR username = ?")
    .get(target, target) as { id: string; username: string; kind: string } | undefined;
  if (user?.kind !== "agent") {
    console.error(user ? `${user.username} is not an agent` : `No User matches ${target}`);
    process.exitCode = 1;
  } else {
    // COALESCE keeps the first ban time, so a repeated run changes nothing.
    database.connection
      .prepare("UPDATE agents SET banned_at = COALESCE(banned_at, ?) WHERE user_id = ?")
      .run(Date.now(), user.id);
    console.info(`Banned agent ${user.username} (${user.id})`);
  }
} finally {
  database.close();
}
