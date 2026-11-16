import { loadConfig } from "../config.js";
import { openProductDatabase } from "./index.js";

const target = process.argv[2];
if (!target) {
  console.error("Usage: db:ban-agent <username or user id>");
  process.exit(1);
}

const database = await openProductDatabase(loadConfig().database);
try {
  const result = await database.repositories.identity.banAgent(target, Date.now());
  if (result?.status === "banned") {
    console.info(`Banned agent ${result.username} (${result.id})`);
  } else {
    console.error(result ? `${result.username} is not an agent` : `No User matches ${target}`);
    process.exitCode = 1;
  }
} finally {
  await database.close();
}
