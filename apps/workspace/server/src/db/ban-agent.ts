import { loadConfig } from "../config.js";
import { openProductDatabase } from "./index.js";
import { describeUser, resolveOperatorTarget } from "./operator-target.js";

const target = process.argv[2];
if (!target) {
  console.error("Usage: db:ban-agent <username or user id>");
  process.exit(1);
}

const database = await openProductDatabase(loadConfig().database);
try {
  const identity = database.repositories.identity;
  const user = await resolveOperatorTarget(identity, target);
  if (user?.kind === "agent") {
    await identity.banAgent(user.id, Date.now());
    console.info(`Banned agent ${describeUser(user)}`);
  } else if (user) {
    console.error(`${user.username} is not an agent`);
    process.exitCode = 1;
  }
} finally {
  await database.close();
}
